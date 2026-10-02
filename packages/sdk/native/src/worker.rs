//! Neon bindings for the worker (called a service in the exported function names).
//!
//! ## Core-driven polling with multi-channel fan-out
//!
//! sdk-core does all gRPC polling, runs the state machines and validates replay. The
//! TypeScript side only runs handlers, pulling work through the functions in this module.
//!
//! ### Why fan-out
//!
//! A single shared channel would make every TypeScript polling loop wait on the same
//! receiver lock, so polls would run one at a time. Instead, a distributor task takes work
//! from sdk-core's single channel and hands it round-robin to one channel per slot:
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                      sdk-core (Rust Core Layer)                         │
//! │   WorkflowDriver produces work on a single channel                      │
//! └────────────────────────────┬────────────────────────────────────────────┘
//!                              │ Single channel from sdk-core
//!                              ▼
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                    Fan-Out Distributor (Rust FFI Layer)                 │
//! │   Distributes work round-robin to multiple slot channels                │
//! └────┬──────────┬──────────┬──────────┬──────────┬───────────────────────┘
//!      │          │          │          │          │
//!      ▼          ▼          ▼          ▼          ▼
//!   Slot 0     Slot 1     Slot 2     Slot 3     Slot N   (Independent channels)
//!      │          │          │          │          │
//!      ▼          ▼          ▼          ▼          ▼
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                   TypeScript Polling Loops                              │
//! │   Each loop polls from its own slot, with no shared lock                │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! Each polling loop has its own channel, so polls run concurrently without contending for
//! a lock, round-robin spreads work evenly, and more slots give more parallelism.

use base64::Engine;
use neon::prelude::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch, Mutex as TokioMutex};

use crate::journal_times::JournalTimes;
use crate::runtime::Runtime;
use crate::types::{
    get_optional_number_property, get_optional_string_property, get_string_property,
};

use orcher_proto::orcher::v1::actor_service_client::ActorServiceClient;
use orcher_sdk_core::bridge::{task_to_execution_request, ExecutionResult};
use orcher_sdk_core::poller::{
    ActorDriver, ActorDriverConfig, ActorDriverEvent, ActorWorkResult, SessionQueueChange,
    ShutdownHandle, TaskDriver, TaskDriverConfig, TaskWorkResult, WorkerMetrics, WorkflowDriver,
    WorkflowDriverConfig, WorkflowWorkResult,
};
use tonic::transport::Channel;

macro_rules! log_debug {
    ($($arg:tt)*) => {
        tracing::debug!($($arg)*);
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        tracing::error!($($arg)*);
    };
}

macro_rules! log_info {
    ($($arg:tt)*) => {
        tracing::info!($($arg)*);
    };
}

// ============================================================================
// Worker configuration
// ============================================================================

/// Worker configuration read from the JavaScript config object.
#[derive(Clone, Debug)]
pub struct ServiceConfig {
    pub server_url: String,
    pub namespace: String,
    pub task_queue: String,
    pub identity: Option<String>,
    pub max_concurrent_workflows: usize,
    pub max_concurrent_tasks: usize,
    /// Organization the worker acts for, on a multi-tenant server.
    pub organization_id: Option<String>,
    /// Sent as `authorization: Bearer <key>` on every poll.
    pub api_key: Option<String>,
    /// TLS settings. `None` connects in plaintext.
    pub tls_config: Option<orcher_sdk_core::poller::TlsConfig>,
    /// The code release this worker is running.
    ///
    /// Sent on every poll and at registration. The server binds an execution to it on
    /// first claim, so replay keeps running against the code the execution started on.
    /// The value is opaque: it is never parsed or ordered.
    pub version_id: Option<String>,
}

impl ServiceConfig {
    /// The configured identity, or `ts-service-<nanoseconds since epoch>` when none is set.
    ///
    /// Without a configured identity, each call returns a different value.
    pub fn get_identity(&self) -> String {
        self.identity.clone().unwrap_or_else(|| {
            format!(
                "ts-service-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            )
        })
    }

    /// Build the sdk-core workflow driver config.
    pub fn to_workflow_driver_config(&self, poller_count: usize) -> WorkflowDriverConfig {
        let mut config = WorkflowDriverConfig::default();
        config.server_url = self.server_url.clone();
        config.namespace = self.namespace.clone();
        config.task_queue = self.task_queue.clone();
        config.max_concurrent_executions = self.max_concurrent_workflows;
        config.identity = self.get_identity();
        config.poll_timeout = Duration::from_secs(60);
        config.cache_capacity = 1000;
        config.strict_determinism = false;
        config.poller_count = poller_count;
        config.organization_id = self.organization_id.clone();
        config.api_key = self.api_key.clone();
        config.tls_config = self.tls_config.clone();
        config.version_id = self.version_id.clone();
        config
    }

    /// Build the sdk-core task driver config.
    pub fn to_task_driver_config(&self, poller_count: usize) -> TaskDriverConfig {
        let mut config = TaskDriverConfig::default();
        config.server_url = self.server_url.clone();
        config.namespace = self.namespace.clone();
        config.task_queue = self.task_queue.clone();
        config.max_concurrent_executions = self.max_concurrent_tasks;
        config.identity = self.get_identity();
        config.poll_timeout = Duration::from_secs(60);
        config.enable_heartbeat = true;
        config.heartbeat_interval = Duration::from_secs(30);
        config.poller_count = poller_count;
        config.organization_id = self.organization_id.clone();
        config.api_key = self.api_key.clone();
        config.tls_config = self.tls_config.clone();
        config.version_id = self.version_id.clone();
        // Every task is heartbeated while it runs, whatever its code does, so a task
        // whose worker dies is retried rather than left started.
        config.auto_heartbeat = true;
        config
    }

    /// Build the sdk-core actor driver config.
    pub fn to_actor_driver_config(
        &self,
        service_id: &str,
        poller_count: usize,
        registration_id: Option<String>,
    ) -> ActorDriverConfig {
        let mut config = ActorDriverConfig::default();
        config.server_url = self.server_url.clone();
        config.namespace = self.namespace.clone();
        config.service_id = service_id.to_string();
        config.max_concurrent_executions = 100;
        config.identity = self.get_identity();
        config.poll_timeout = Duration::from_secs(30);
        config.poller_count = poller_count;
        config.organization_id = self.organization_id.clone();
        config.api_key = self.api_key.clone();
        config.enable_heartbeat = true;
        config.heartbeat_interval = Duration::from_secs(10);
        config.registration_id = registration_id;
        config.tls_config = self.tls_config.clone();
        config
    }
}

// ============================================================================
// Fan-out types
// ============================================================================

/// A workflow activation serialized to JSON for TypeScript.
#[derive(Debug, Clone)]
struct SerializedWorkflowWork {
    json_str: String,
}

/// A task serialized to JSON for TypeScript.
#[derive(Debug, Clone)]
struct SerializedTaskWork {
    json_str: String,
}

/// A task handed to JavaScript whose outcome is not yet reported.
///
/// `heartbeat` is what the task's code records heartbeats through; heartbeating stops once
/// this is dropped. `reported` is cancelled when JavaScript reports the outcome.
struct RunningTask {
    heartbeat: orcher_sdk_core::poller::TaskHeartbeat,
    reported: orcher_sdk_core::poller::CancellationToken,
}

/// The tasks handed to JavaScript and not yet reported, by task token.
type RunningTasks = Arc<std::sync::Mutex<HashMap<Vec<u8>, RunningTask>>>;

/// Drop a task JavaScript has reported.
///
/// Its heartbeat stops once the driver has sent the outcome, and anything waiting on its
/// cancellation (`waitTaskCancelled`) is released.
fn task_reported(running: &RunningTasks, token: &[u8]) {
    let task = running.lock().unwrap_or_else(|p| p.into_inner()).remove(token);
    if let Some(task) = task {
        task.reported.cancel();
    }
}

/// Fan-out state for workflow polling.
struct WorkflowFanOut {
    /// One receiver per slot, each behind its own lock so slots are polled independently.
    slot_receivers: Vec<Arc<TokioMutex<mpsc::Receiver<SerializedWorkflowWork>>>>,
}

/// Fan-out state for task polling.
struct TaskFanOut {
    /// One receiver per slot, each behind its own lock so slots are polled independently.
    slot_receivers: Vec<Arc<TokioMutex<mpsc::Receiver<SerializedTaskWork>>>>,
}

/// An actor operation serialized to JSON for TypeScript.
#[derive(Debug, Clone)]
pub(crate) struct SerializedActorWork {
    pub(crate) json_str: String,
}

/// Fan-out state for actor operation polling.
pub(crate) struct ActorFanOut {
    /// One receiver per slot, each behind its own lock so slots are polled independently.
    pub(crate) slot_receivers: Vec<Arc<TokioMutex<mpsc::Receiver<SerializedActorWork>>>>,
    /// Shutdown signal, cloned by each actor poll.
    pub(crate) shutdown_rx: watch::Receiver<bool>,
}

// ============================================================================
// Worker handle types
// ============================================================================

/// How long `shutdown` waits for each of the workflow and task drivers to stop.
///
/// A driver finishes its whole shutdown, draining included, within a grace period (five
/// seconds by default) counted from when it was told to stop, normally at
/// `serviceRequestShutdown`. This timeout must stay above that grace period, or it would
/// cut the drain short. It exists for a driver stuck somewhere else: shutdown must return
/// even then.
const DRIVER_STOP_TIMEOUT: Duration = Duration::from_secs(10);

/// A running driver: the handle that asks it to stop, and the task running it.
type RunningDriver = (ShutdownHandle, tokio::task::JoinHandle<()>);

/// The workflow and task drivers, as `shutdown` takes them.
struct DriverStops {
    workflow: RunningDriver,
    task: RunningDriver,
}

impl DriverStops {
    /// Ask both drivers to stop; they then finish within their shutdown grace period.
    fn signal(&self) {
        self.workflow.0.shutdown();
        self.task.0.shutdown();
    }
}

/// Wait up to `DRIVER_STOP_TIMEOUT` for a driver already asked to stop,
/// abandoning it if it does not.
async fn await_driver(driver: &str, mut run: tokio::task::JoinHandle<()>) {
    if tokio::time::timeout(DRIVER_STOP_TIMEOUT, &mut run)
        .await
        .is_err()
    {
        log_error!(
            "{} driver did not stop within {:?}; abandoning it",
            driver,
            DRIVER_STOP_TIMEOUT
        );
        run.abort();
    }
}

/// Senders that return results to the sdk-core drivers.
///
/// They are `Clone`, so completions clone them out of the lock and send concurrently.
#[derive(Clone)]
pub(crate) struct WorkerSenders {
    pub(crate) workflow_result_tx: mpsc::Sender<WorkflowWorkResult>,
    pub(crate) task_result_tx: mpsc::Sender<TaskWorkResult>,
    pub(crate) actor_result_tx: mpsc::Sender<ActorWorkResult>,
}

/// The worker handle JavaScript holds, boxed.
///
/// The fan-out and sender fields are `None` until `serviceStart` and again after
/// `serviceShutdown`.
pub struct WorkerHandleType {
    pub(crate) config: ServiceConfig,
    workflow_fan_out: Arc<TokioMutex<Option<WorkflowFanOut>>>,
    task_fan_out: Arc<TokioMutex<Option<TaskFanOut>>>,
    pub(crate) actor_fan_out: Arc<TokioMutex<Option<ActorFanOut>>>,
    pub(crate) senders: Arc<std::sync::RwLock<Option<WorkerSenders>>>,
    shutdown_tx: Arc<std::sync::Mutex<Option<watch::Sender<bool>>>>,
    /// Set by `start`, taken by `shutdown`.
    driver_stops: Arc<std::sync::Mutex<Option<DriverStops>>>,
    workflow_slot_count: AtomicUsize,
    task_slot_count: AtomicUsize,
    pub(crate) actor_slot_count: AtomicUsize,
    /// gRPC client for actor state RPCs, created on first use and separate from the
    /// actor driver's connection.
    pub(crate) actor_state_client: Arc<TokioMutex<Option<ActorServiceClient<Channel>>>>,
    /// Service ID for actor operations: `ts-actor-<nanoseconds since epoch>`.
    pub(crate) actor_service_id: String,
    /// The tasks handed to JavaScript and not yet reported.
    running_tasks: RunningTasks,
    /// Lets JavaScript add and remove session queues while the worker runs.
    session_queue_tx: Arc<std::sync::Mutex<Option<mpsc::UnboundedSender<SessionQueueChange>>>>,
}

impl WorkerHandleType {
    fn new(config: ServiceConfig) -> Self {
        let actor_service_id = format!(
            "ts-actor-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        Self {
            config,
            workflow_fan_out: Arc::new(TokioMutex::new(None)),
            task_fan_out: Arc::new(TokioMutex::new(None)),
            actor_fan_out: Arc::new(TokioMutex::new(None)),
            senders: Arc::new(std::sync::RwLock::new(None)),
            shutdown_tx: Arc::new(std::sync::Mutex::new(None)),
            driver_stops: Arc::new(std::sync::Mutex::new(None)),
            workflow_slot_count: AtomicUsize::new(0),
            task_slot_count: AtomicUsize::new(0),
            actor_slot_count: AtomicUsize::new(0),
            actor_state_client: Arc::new(TokioMutex::new(None)),
            actor_service_id,
            running_tasks: Arc::default(),
            session_queue_tx: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

impl Finalize for WorkerHandleType {}

// ============================================================================
// Create
// ============================================================================

/// Create a worker handle from a JavaScript config object.
///
/// Throws when a required field is missing, a TLS file cannot be read, or
/// `tls.rejectUnauthorized` is `false`. A blank `versionId` counts as not set.
///
/// JavaScript signature:
/// ```typescript
/// function serviceCreate(config: ServiceConfig): ServiceHandle;
/// ```
pub fn create(mut cx: FunctionContext) -> JsResult<JsBox<WorkerHandleType>> {
    let config_obj = cx.argument::<JsObject>(0)?;

    let server_url = get_string_property(&mut cx, config_obj, "serverUrl")?;
    let namespace = get_string_property(&mut cx, config_obj, "namespace")?;
    let task_queue = get_string_property(&mut cx, config_obj, "taskQueue")?;
    let identity = get_optional_string_property(&mut cx, config_obj, "identity")?;
    let organization_id = get_optional_string_property(&mut cx, config_obj, "organizationId")?;
    let api_key = get_optional_string_property(&mut cx, config_obj, "apiKey")?;
    // Blank means "not declared". Otherwise an exported but empty value would bind
    // executions to a release literally named "" and look like versioning was working.
    let version_id = get_optional_string_property(&mut cx, config_obj, "versionId")?
        .filter(|v| !v.trim().is_empty());
    let max_concurrent_workflows =
        get_optional_number_property(&mut cx, config_obj, "maxConcurrentWorkflows")?
            .unwrap_or(100.0) as usize;
    let max_concurrent_tasks =
        get_optional_number_property(&mut cx, config_obj, "maxConcurrentTasks")?.unwrap_or(100.0)
            as usize;

    let tls_config = {
        let tls_value: Handle<JsValue> = config_obj.get(&mut cx, "tls")?;
        if tls_value.is_a::<JsNull, _>(&mut cx) || tls_value.is_a::<JsUndefined, _>(&mut cx) {
            None
        } else {
            let tls_obj = tls_value
                .downcast::<JsObject, _>(&mut cx)
                .or_else(|_| cx.throw_error("tls must be an object"))?;
            // Certificate verification cannot be turned off by the transport;
            // reject the option rather than silently ignoring it.
            if let Some(false) =
                crate::types::get_optional_bool_property(&mut cx, tls_obj, "rejectUnauthorized")?
            {
                return cx.throw_error(
                    "tls.rejectUnauthorized: false is not supported — certificate \
                     verification cannot be disabled. Supply the server's CA via \
                     tls.caPath instead.",
                );
            }

            // A missing caPath means "verify against the system trust store", not "no
            // TLS". Treating it as no TLS would make a worker configured for mTLS against
            // a publicly trusted server connect in plaintext without any error.
            let ca_path = get_optional_string_property(&mut cx, tls_obj, "caPath")?;
            let ca_cert = ca_path
                .map(|path| {
                    std::fs::read(&path).or_else(|e| {
                        cx.throw_error(format!("Failed to read CA cert '{}': {}", path, e))
                    })
                })
                .transpose()?;
            let cert_path = get_optional_string_property(&mut cx, tls_obj, "certPath")?;
            let key_path = get_optional_string_property(&mut cx, tls_obj, "keyPath")?;
            let client_cert = cert_path
                .map(|p| {
                    std::fs::read(&p).or_else(|e| {
                        cx.throw_error(format!("Failed to read client cert '{}': {}", p, e))
                    })
                })
                .transpose()?;
            let client_key = key_path
                .map(|p| {
                    std::fs::read(&p).or_else(|e| {
                        cx.throw_error(format!("Failed to read client key '{}': {}", p, e))
                    })
                })
                .transpose()?;
            let mut tls = orcher_sdk_core::poller::TlsConfig::new();
            tls.ca_cert = ca_cert;
            tls.client_cert = client_cert;
            tls.client_key = client_key;
            Some(tls)
        }
    };

    let config = ServiceConfig {
        server_url: server_url.clone(),
        namespace: namespace.clone(),
        task_queue: task_queue.clone(),
        identity,
        max_concurrent_workflows,
        max_concurrent_tasks,
        organization_id,
        api_key,
        tls_config,
        version_id,
    };

    let handle = WorkerHandleType::new(config);

    log_info!(
        "Created service handle: server={}, namespace={}, queue={}",
        server_url,
        namespace,
        task_queue
    );

    Ok(cx.boxed(handle))
}

// ============================================================================
// Start
// ============================================================================

/// Start the worker: create the sdk-core drivers and the fan-out to polling slots.
///
/// Creates the `WorkflowDriver` and `TaskDriver`, and an `ActorDriver` when
/// `actorPollerCount` is above zero. A distributor task per driver hands work
/// round-robin to one channel per slot, so each TypeScript polling loop has its own
/// channel. Also starts the worker registration driver, which registers the worker and
/// sends heartbeats; if it cannot be created, the worker runs without it and logs that at
/// info level.
///
/// JavaScript signature:
/// ```typescript
/// function serviceStart(
///   service: ServiceHandle,
///   workflowPollerCount: number,
///   taskPollerCount: number,
///   actorPollerCount?: number,       // default 0: no actor driver
///   actorRegistrationId?: string     // from registerActorHandlers
/// ): Promise<void>;
/// ```
pub fn start(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let workflow_poller_count = cx.argument::<JsNumber>(1)?.value(&mut cx) as usize;
    let task_poller_count = cx.argument::<JsNumber>(2)?.value(&mut cx) as usize;
    let actor_poller_count = cx
        .argument_opt(3)
        .and_then(|v| v.downcast::<JsNumber, _>(&mut cx).ok())
        .map(|n| n.value(&mut cx) as usize)
        .unwrap_or(0);
    let actor_registration_id = cx
        .argument_opt(4)
        .and_then(|v| v.downcast::<JsString, _>(&mut cx).ok())
        .map(|s| s.value(&mut cx));

    let config = service_box.config.clone();
    let actor_service_id = service_box.actor_service_id.clone();
    let workflow_fan_out_holder = service_box.workflow_fan_out.clone();
    let task_fan_out_holder = service_box.task_fan_out.clone();
    let actor_fan_out_holder = service_box.actor_fan_out.clone();
    let senders_holder = service_box.senders.clone();
    let shutdown_tx_holder = service_box.shutdown_tx.clone();
    let driver_stops_holder = service_box.driver_stops.clone();
    let session_queue_tx_holder = service_box.session_queue_tx.clone();
    let running_tasks = Arc::clone(&service_box.running_tasks);

    service_box
        .workflow_slot_count
        .store(workflow_poller_count, Ordering::SeqCst);
    service_box
        .task_slot_count
        .store(task_poller_count, Ordering::SeqCst);
    service_box
        .actor_slot_count
        .store(actor_poller_count, Ordering::SeqCst);

    log_info!(
        "Starting service with {} workflow poll slots, {} task poll slots, {} actor poll slots (multi-channel fan-out)",
        workflow_poller_count,
        task_poller_count,
        actor_poller_count
    );

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        {
            let mut guard = shutdown_tx_holder.lock().unwrap();
            *guard = Some(shutdown_tx);
        }

        let workflow_driver_config = config.to_workflow_driver_config(workflow_poller_count);
        let task_driver_config = config.to_task_driver_config(task_poller_count);

        log_debug!(
            "Creating workflow driver: server={}, namespace={}, queue={}",
            workflow_driver_config.server_url,
            workflow_driver_config.namespace,
            workflow_driver_config.task_queue
        );

        // One set of counters for this worker, shared by the drivers that run work and
        // the driver that heartbeats. Without sharing, every heartbeat would report zero
        // work in progress and the server would show a busy worker as idle.
        let worker_metrics = WorkerMetrics::new();

        let (workflow_driver, workflow_work_rx, workflow_result_tx) =
            WorkflowDriver::new(workflow_driver_config)
                .await
                .map_err(|e| format!("Failed to create workflow driver: {}", e))?;
        let workflow_driver = workflow_driver.with_metrics(worker_metrics.clone());

        log_info!("Workflow driver created successfully");

        let (mut task_driver, task_work_rx, task_result_tx, session_queue_tx) =
            TaskDriver::new(task_driver_config)
                .await
                .map_err(|e| format!("Failed to create task driver: {}", e))?;
        task_driver = task_driver.with_metrics(worker_metrics.clone());

        log_info!("Task driver created successfully");

        // Workflow fan-out: one channel per polling slot.
        let mut workflow_slot_receivers = Vec::with_capacity(workflow_poller_count);
        let mut workflow_senders = Vec::with_capacity(workflow_poller_count);

        for _ in 0..workflow_poller_count {
            let (tx, rx) = mpsc::channel::<SerializedWorkflowWork>(10);
            workflow_slot_receivers.push(Arc::new(TokioMutex::new(rx)));
            workflow_senders.push(tx);
        }

        let workflow_fan_out = WorkflowFanOut {
            slot_receivers: workflow_slot_receivers,
        };

        // Task fan-out: one channel per polling slot.
        let mut task_slot_receivers = Vec::with_capacity(task_poller_count);
        let mut task_senders = Vec::with_capacity(task_poller_count);

        for _ in 0..task_poller_count {
            let (tx, rx) = mpsc::channel::<SerializedTaskWork>(10);
            task_slot_receivers.push(Arc::new(TokioMutex::new(rx)));
            task_senders.push(tx);
        }

        let task_fan_out = TaskFanOut {
            slot_receivers: task_slot_receivers,
        };

        // Actor driver and fan-out, only when actor pollers are requested.
        let actor_result_tx = if actor_poller_count > 0 {
            let actor_driver_config = config.to_actor_driver_config(
                &actor_service_id,
                actor_poller_count,
                actor_registration_id,
            );

            let (mut actor_driver, actor_work_rx, actor_result_tx, mut event_rx) =
                ActorDriver::new(actor_driver_config)
                    .await
                    .map_err(|e| format!("Failed to create actor driver: {}", e))?;

            log_info!("Actor driver created successfully");

            // Driver events are only logged. On a re-registration request, the TypeScript
            // side is expected to call registerActorHandlers again.
            tokio::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    match event {
                        ActorDriverEvent::ReRegistrationRequired => {
                            log_info!(
                                "Actor driver requested re-registration — \
                                 TS should call registerActorHandlers again"
                            );
                        }
                    }
                }
                log_debug!("Actor driver event channel closed");
            });

            let mut actor_slot_receivers = Vec::with_capacity(actor_poller_count);
            let mut actor_senders = Vec::with_capacity(actor_poller_count);

            for _ in 0..actor_poller_count {
                let (tx, rx) = mpsc::channel::<SerializedActorWork>(10);
                actor_slot_receivers.push(Arc::new(TokioMutex::new(rx)));
                actor_senders.push(tx);
            }

            let actor_fan_out = ActorFanOut {
                slot_receivers: actor_slot_receivers,
                shutdown_rx: shutdown_rx.clone(),
            };

            {
                let mut guard = actor_fan_out_holder.lock().await;
                *guard = Some(actor_fan_out);
            }

            // The actor distributor stops on the shutdown signal, unlike the workflow and
            // task distributors below.
            let actor_senders_clone = actor_senders;
            let mut actor_work_rx = actor_work_rx;
            let actor_shutdown_rx = shutdown_rx.clone();

            tokio::spawn(async move {
                log_info!(
                    "Actor distributor started with {} slots",
                    actor_senders_clone.len()
                );
                let mut slot_idx = 0usize;
                let mut shutdown_watch = actor_shutdown_rx;

                loop {
                    tokio::select! {
                        biased;

                        result = shutdown_watch.changed() => {
                            if result.is_err() || *shutdown_watch.borrow() {
                                log_info!("Actor distributor shutdown");
                                break;
                            }
                        }

                        work = actor_work_rx.recv() => {
                            match work {
                                Some(actor_work) => {
                                    let op = &actor_work.operation;
                                    let actor_request = serde_json::json!({
                                        "operation_id": op.operation_id,
                                        "actor_name": op.actor_name,
                                        "key": op.key,
                                        "operation": op.operation,
                                        "payload": base64::engine::general_purpose::STANDARD.encode(&op.payload),
                                        "mode": op.mode,
                                        "execution_id": op.execution_id,
                                        "metadata": op.metadata,
                                    });

                                    let json_str = match serde_json::to_string(&actor_request) {
                                        Ok(s) => s,
                                        Err(e) => {
                                            log_error!("Failed to serialize actor work: {}", e);
                                            continue;
                                        }
                                    };

                                    let serialized = SerializedActorWork { json_str };

                                    let target_slot = slot_idx % actor_senders_clone.len();
                                    slot_idx = slot_idx.wrapping_add(1);

                                    log_debug!(
                                        "Distributing actor op {} to slot {}",
                                        op.operation_id,
                                        target_slot
                                    );

                                    if let Err(e) = actor_senders_clone[target_slot].send(serialized).await {
                                        log_error!("Failed to send to actor slot {}: {}", target_slot, e);
                                    }
                                }
                                None => {
                                    log_info!("Actor work channel closed");
                                    break;
                                }
                            }
                        }
                    }
                }
            });

            tokio::spawn(async move {
                if let Err(e) = actor_driver.run().await {
                    log_error!("Actor driver error: {}", e);
                }
            });

            Some(actor_result_tx)
        } else {
            None
        };

        {
            let mut guard = workflow_fan_out_holder.lock().await;
            *guard = Some(workflow_fan_out);
        }
        {
            let mut guard = task_fan_out_holder.lock().await;
            *guard = Some(task_fan_out);
        }

        // Without an actor driver, actor results go to a channel whose receiver is already
        // dropped, so sending one fails instead of blocking.
        let actor_result_tx = actor_result_tx.unwrap_or_else(|| {
            let (tx, _rx) = mpsc::channel(1);
            tx
        });

        let worker_senders = WorkerSenders {
            workflow_result_tx,
            task_result_tx,
            actor_result_tx,
        };

        {
            let mut guard = senders_holder.write().unwrap();
            *guard = Some(worker_senders);
        }

        {
            let mut guard = session_queue_tx_holder.lock().unwrap();
            *guard = Some(session_queue_tx);
        }

        // Workflow distributor: takes work from sdk-core's single channel and hands it
        // round-robin to the slot channels.
        //
        // Unlike the actor distributor, this one does not stop on the shutdown signal, and
        // neither does the task distributor. During its shutdown grace period the workflow
        // driver keeps handing over what its polls bring back, and each of those
        // activations is already claimed on the engine: dropped here, it would wait out
        // the claim timeout. So the distributor forwards until the driver has stopped and
        // dropped its sender, and only then drops the slot senders, which is what ends the
        // TypeScript workflow polling loops.
        let workflow_senders_clone = workflow_senders;
        let mut workflow_work_rx = workflow_work_rx;

        tokio::spawn(async move {
            log_info!(
                "🔵 Workflow distributor started with {} slots",
                workflow_senders_clone.len()
            );
            let mut slot_idx = 0usize;

            while let Some(workflow_work) = workflow_work_rx.recv().await {
                let workflow_id = workflow_work.task.execution.workflow_id.clone();
                let run_id = workflow_work.task.execution.run_id.clone();

                let exec_request = match task_to_execution_request(workflow_work.task.clone()) {
                    Ok(req) => req,
                    Err(e) => {
                        // Nothing will answer this activation, so it stays claimed until
                        // the engine's claim timeout. The log names which one.
                        log_error!(
                            "Failed to convert workflow task {}/{}; activation dropped: {}",
                            workflow_id,
                            run_id,
                            e
                        );
                        continue;
                    }
                };

                // The jobs carry no times; the workflow's clock is read from
                // the journal they came from.
                let mut execution_request = match serde_json::to_value(&exec_request) {
                    Ok(value) => value,
                    Err(e) => {
                        log_error!(
                            "Failed to serialize workflow task {}/{}; activation dropped: {}",
                            workflow_id,
                            run_id,
                            e
                        );
                        continue;
                    }
                };
                if let Some(request) = execution_request.as_object_mut() {
                    request.insert(
                        "journal_times".to_string(),
                        serde_json::json!(JournalTimes::read(&workflow_work.task.journal)),
                    );
                }

                let response = serde_json::json!({
                    "execution_request": execution_request,
                    "workflow_id": workflow_work.task.execution.workflow_id,
                    "run_id": workflow_work.task.execution.run_id,
                    "task_token": base64::engine::general_purpose::STANDARD.encode(&workflow_work.task.task_token),
                    "stream_entry_id": workflow_work.stream_entry_id,
                });

                let json_str = match serde_json::to_string(&response) {
                    Ok(s) => s,
                    Err(e) => {
                        log_error!(
                            "Failed to serialize workflow work {}/{}; activation dropped: {}",
                            workflow_id,
                            run_id,
                            e
                        );
                        continue;
                    }
                };

                let serialized = SerializedWorkflowWork { json_str };

                let target_slot = slot_idx % workflow_senders_clone.len();
                slot_idx = slot_idx.wrapping_add(1);

                log_debug!(
                    "🔵 Distributing workflow {} to slot {}",
                    workflow_id,
                    target_slot
                );

                if let Err(e) = workflow_senders_clone[target_slot].send(serialized).await {
                    log_error!(
                        "Failed to send workflow {}/{} to slot {}; activation dropped: {}",
                        workflow_id,
                        run_id,
                        target_slot,
                        e
                    );
                }
            }
            log_info!("🔵 Workflow work channel closed");
        });

        // Task distributor. Like the workflow distributor, it forwards until the task
        // driver has stopped and dropped its sender: each task the driver hands over during
        // its shutdown grace period is already claimed on the engine, and dropped here it
        // would wait out its start-to-close timeout.
        let task_senders_clone = task_senders;
        let mut task_work_rx = task_work_rx;

        tokio::spawn(async move {
            log_info!(
                "🟢 Task distributor started with {} slots",
                task_senders_clone.len()
            );
            let mut slot_idx = 0usize;

            loop {
                match task_work_rx.recv().await {
                    Some(task_work) => {
                        let task = &task_work.task;

                        let task_request = serde_json::json!({
                            "task_id": task.task_id,
                            "task_type": task.task_type,
                            "task_token": base64::engine::general_purpose::STANDARD.encode(&task.task_token),
                            "workflow_id": task.execution.workflow_id,
                            "execution_id": task.execution.run_id,
                            "task_queue": task.task_queue,
                            "input": task.input,
                            "attempt": task.attempt,
                            // The heartbeat timeout this task is judged by, which
                            // `TaskContext.heartbeatTimeout()` exposes so a handler can pace
                            // its heartbeats against the limit that decides whether it is
                            // killed. Milliseconds, or null when the engine set none.
                            "heartbeat_timeout_ms": task
                                .heartbeat_timeout
                                .map(|d| d.as_millis() as u64),
                        });

                        let json_str = match serde_json::to_string(&task_request) {
                            Ok(s) => s,
                            Err(e) => {
                                log_error!("Failed to serialize task work: {}", e);
                                continue;
                            }
                        };

                        let serialized = SerializedTaskWork { json_str };
                        // Kept until JavaScript reports the task, so it is heartbeated
                        // while it runs. Released below if it cannot be handed over.
                        running_tasks.lock().unwrap_or_else(|p| p.into_inner()).insert(
                            task.task_token.clone(),
                            RunningTask {
                                heartbeat: task_work.heartbeat.clone(),
                                reported: Default::default(),
                            },
                        );

                        let target_slot = slot_idx % task_senders_clone.len();
                        slot_idx = slot_idx.wrapping_add(1);

                        log_debug!(
                            "🟢 Distributing task {} to slot {}",
                            task.task_id,
                            target_slot
                        );

                        if let Err(e) = task_senders_clone[target_slot].send(serialized).await {
                            log_error!("Failed to send to task slot {}: {}", target_slot, e);
                            task_reported(&running_tasks, &task_work.task.task_token);
                        }
                    }
                    None => {
                        log_info!("🟢 Task work channel closed");
                        break;
                    }
                }
            }
        });

        // Eager task injection: tasks scheduled by workflow completions go straight into the
        // task driver's work channel, skipping a poll round trip.
        let mut workflow_driver = workflow_driver
            .with_eager_task_injector(task_driver.eager_task_injector());

        // Take the stop handle before the driver moves into its task: `run` borrows the
        // driver while it runs, and stopping it through the handle is what lets it send the
        // results it holds instead of dropping them.
        let workflow_stop = workflow_driver.shutdown_handle();

        log_info!("🔵 About to spawn workflow driver run() task");
        let workflow_run = tokio::spawn(async move {
            log_info!("🔵 Workflow driver spawn task STARTED - calling run()");
            if let Err(e) = workflow_driver.run().await {
                log_error!("Workflow driver error: {}", e);
            }
            log_info!("🔵 Workflow driver run() returned");
        });
        log_info!("🔵 Workflow driver spawn() returned");

        let task_stop = task_driver.shutdown_handle();
        let task_run = tokio::spawn(async move {
            if let Err(e) = task_driver.run().await {
                log_error!("Task driver error: {}", e);
            }
        });
        *driver_stops_holder.lock().unwrap() = Some(DriverStops {
            workflow: (workflow_stop, workflow_run),
            task: (task_stop, task_run),
        });

        // Worker registration driver: registers the worker and sends its heartbeats.
        let registration_metrics = worker_metrics.clone();
        {
            use orcher_sdk_core::poller::{WorkerRegistrationConfig, WorkerRegistrationDriver};

            let mut metadata = std::collections::HashMap::new();
            metadata.insert("sdk".to_string(), "typescript".to_string());
            metadata.insert("sdk_version".to_string(), env!("CARGO_PKG_VERSION").to_string());

            let mut reg_config = WorkerRegistrationConfig::default();
            reg_config.server_url = config.server_url.clone();
            reg_config.service_id = config.get_identity();
            reg_config.identity = config.get_identity();
            reg_config.task_queue = config.task_queue.clone();
            reg_config.namespace = config.namespace.clone();
            reg_config.heartbeat_interval = Duration::from_secs(10);
            reg_config.metadata = metadata;
            reg_config.version_id = config.version_id.clone();
            // Registration talks to the same server as the pollers, so it needs the same
            // TLS settings and credentials. Without them it would dial a TLS server in
            // plaintext, or connect unauthenticated, and the only trace would be "Worker
            // registration skipped" at info level.
            reg_config.tls_config = config.tls_config.clone();
            reg_config.api_key = config.api_key.clone();
            reg_config.organization_id = config.organization_id.clone();

            match WorkerRegistrationDriver::new(reg_config).await {
                Ok(driver) => {
                    let mut driver = driver.with_metrics(registration_metrics);
                    log_info!("Worker registration driver started");
                    tokio::spawn(async move {
                        if let Err(e) = driver.run().await {
                            log_error!("Worker registration driver error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    log_info!("Worker registration skipped: {}", e);
                }
            }
        }

        log_info!("Service started successfully with multi-channel fan-out");
        Ok(())
    })
}

// ============================================================================
// Poll workflow task (TypeScript passes the slot index)
// ============================================================================

/// Poll one slot for a workflow activation.
///
/// Each TypeScript polling loop uses its own slot index (0 to N-1), so loops poll in
/// parallel without contending for one lock. Resolves to the activation as a JSON string,
/// or `null` when none arrives within 30 seconds. Rejects once the slot's channel has
/// closed, which happens after the workflow driver has stopped.
///
/// JavaScript signature:
/// ```typescript
/// function pollWorkflowTask(service: ServiceHandle, slotIndex: number): Promise<string | null>;
/// ```
pub fn poll_workflow_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let slot_index = cx.argument::<JsNumber>(1)?.value(&mut cx) as usize;

    let workflow_fan_out = service_box.workflow_fan_out.clone();
    let slot_count = service_box.workflow_slot_count.load(Ordering::SeqCst);

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        if slot_index >= slot_count {
            return Err(format!(
                "Invalid slot index {}, max is {}",
                slot_index,
                slot_count.saturating_sub(1)
            ));
        }

        let fan_out_guard = workflow_fan_out.lock().await;
        let fan_out = fan_out_guard
            .as_ref()
            .ok_or_else(|| "Service not started".to_string())?;

        // No shutdown check here, unlike the actor poll. During shutdown the workflow
        // driver still hands over what its polls bring back, already claimed on the
        // engine, and this is the only way it reaches TypeScript. So a workflow poll ends
        // only when its slot channel closes, once the driver has stopped.
        let slot_receiver = fan_out.slot_receivers[slot_index].clone();

        // Release the shared fan-out lock before waiting, so other slots can poll while
        // this one blocks. Only this slot's receiver stays locked.
        drop(fan_out_guard);

        let mut receiver = slot_receiver.lock().await;

        tokio::select! {
            work = receiver.recv() => {
                match work {
                    Some(serialized_work) => {
                        log_debug!(
                            "🔵 POLL_WORKFLOW_TASK slot {}: Received work",
                            slot_index
                        );
                        Ok(Some(serialized_work.json_str))
                    }
                    None => {
                        Err("Workflow slot channel closed".to_string())
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                // Timeout - no work available
                Ok(None)
            }
        }
    })
}

// ============================================================================
// Poll task (TypeScript passes the slot index)
// ============================================================================

/// Poll one slot for a task.
///
/// Each TypeScript polling loop uses its own slot index (0 to N-1), so loops poll in
/// parallel without contending for one lock. Resolves to the task as a JSON string, or
/// `null` when none arrives within 30 seconds. Rejects once the slot's channel has closed,
/// which happens after the task driver has stopped.
///
/// JavaScript signature:
/// ```typescript
/// function pollTask(service: ServiceHandle, slotIndex: number): Promise<string | null>;
/// ```
pub fn poll_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let slot_index = cx.argument::<JsNumber>(1)?.value(&mut cx) as usize;

    let task_fan_out = service_box.task_fan_out.clone();
    let slot_count = service_box.task_slot_count.load(Ordering::SeqCst);

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        if slot_index >= slot_count {
            return Err(format!(
                "Invalid slot index {}, max is {}",
                slot_index,
                slot_count.saturating_sub(1)
            ));
        }

        let fan_out_guard = task_fan_out.lock().await;
        let fan_out = fan_out_guard
            .as_ref()
            .ok_or_else(|| "Service not started".to_string())?;

        // No shutdown check here, for the same reason as the workflow poll: during
        // shutdown the task driver still hands over what its polls bring back, already
        // claimed on the engine, so a task poll ends only when its slot channel closes,
        // once the driver has stopped.
        let slot_receiver = fan_out.slot_receivers[slot_index].clone();

        // Release the shared fan-out lock before waiting; see `poll_workflow_task`.
        drop(fan_out_guard);

        let mut receiver = slot_receiver.lock().await;

        tokio::select! {
            work = receiver.recv() => {
                match work {
                    Some(serialized_work) => {
                        log_debug!(
                            "🟢 POLL_TASK slot {}: Received work",
                            slot_index
                        );
                        Ok(Some(serialized_work.json_str))
                    }
                    None => {
                        Err("Task slot channel closed".to_string())
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                // Timeout - no work available
                Ok(None)
            }
        }
    })
}

// ============================================================================
// Complete workflow task
// ============================================================================

/// Report a workflow activation's result to sdk-core.
///
/// `resultJson` is an sdk-core `ExecutionResult`; `taskToken` is base64-encoded. Rejects
/// when either does not parse.
///
/// JavaScript signature:
/// ```typescript
/// function completeWorkflowTask(
///   service: ServiceHandle,
///   workflowId: string,
///   executionId: string,
///   resultJson: string,
///   taskToken: string,
///   streamEntryId: string | null
/// ): Promise<void>;
/// ```
pub fn complete_workflow_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let workflow_id = cx.argument::<JsString>(1)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(2)?.value(&mut cx);
    let result_json = cx.argument::<JsString>(3)?.value(&mut cx);
    let task_token = cx.argument::<JsString>(4)?.value(&mut cx);
    let stream_entry_id = cx
        .argument_opt(5)
        .and_then(|v| v.downcast::<JsString, _>(&mut cx).ok())
        .map(|s| s.value(&mut cx));

    // Get sender from RwLock (no async mutex needed - senders are Clone)
    let result_tx = {
        let guard = service_box.senders.read().unwrap();
        let senders = guard
            .as_ref()
            .ok_or_else(|| cx.throw_error::<_, ()>("Service not started").unwrap_err())?;
        senders.workflow_result_tx.clone()
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        log_debug!(
            "🟡 COMPLETE_WORKFLOW_TASK: workflow_id={} run_id={}",
            workflow_id,
            execution_id
        );

        let exec_result: ExecutionResult = serde_json::from_str(&result_json).map_err(|e| {
            log_error!(
                "🔴 COMPLETE_WORKFLOW_TASK: JSON parse error: {} for workflow_id={}",
                e,
                workflow_id
            );
            format!("Invalid result JSON: {}", e)
        })?;

        let task_token_bytes = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;

        let work_result = WorkflowWorkResult {
            workflow_id: workflow_id.clone(),
            run_id: execution_id.clone(),
            task_token: task_token_bytes,
            stream_entry_id,
            result: Ok(exec_result),
        };

        result_tx
            .send(work_result)
            .await
            .map_err(|e| format!("Failed to send result to sdk-core: {}", e))?;

        log_debug!(
            "🟢 COMPLETE_WORKFLOW_TASK: Result sent workflow_id={} run_id={}",
            workflow_id,
            execution_id
        );

        Ok(())
    })
}

// ============================================================================
// Complete task
// ============================================================================

/// Report a task's successful result to sdk-core.
///
/// `resultJson` is sent as the task's result bytes. The task stops being heartbeated once
/// the result is handed to the driver.
///
/// JavaScript signature:
/// ```typescript
/// function completeTask(
///   service: ServiceHandle,
///   taskToken: string,
///   resultJson: string
/// ): Promise<void>;
/// ```
pub fn complete_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let task_token = cx.argument::<JsString>(1)?.value(&mut cx);
    let result_json = cx.argument::<JsString>(2)?.value(&mut cx);
    let running = Arc::clone(&service_box.running_tasks);

    // Get sender from RwLock (no async mutex needed - senders are Clone)
    let result_tx = {
        let guard = service_box.senders.read().unwrap();
        let senders = guard
            .as_ref()
            .ok_or_else(|| cx.throw_error::<_, ()>("Service not started").unwrap_err())?;
        senders.task_result_tx.clone()
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let task_token_bytes = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;

        let work_result = TaskWorkResult {
            task_token: task_token_bytes.clone(),
            result: Ok(result_json.into_bytes()),
        };

        // The task is released even if the send fails, so it is not heartbeated forever.
        let sent = result_tx.send(work_result).await;
        task_reported(&running, &task_token_bytes);
        sent.map_err(|e| format!("Failed to send result to sdk-core: {}", e))?;

        Ok(())
    })
}

// ============================================================================
// Fail workflow task
// ============================================================================

/// Report a workflow activation as failed.
///
/// Sends sdk-core an unsuccessful `ExecutionResult` with no commands, carrying
/// `errorMessage` as a non-retryable `WorkflowCode` error.
///
/// JavaScript signature:
/// ```typescript
/// function failWorkflowTask(
///   service: ServiceHandle,
///   workflowId: string,
///   executionId: string,
///   taskToken: string,
///   errorMessage: string,
///   streamEntryId: string | null
/// ): Promise<void>;
/// ```
pub fn fail_workflow_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let workflow_id = cx.argument::<JsString>(1)?.value(&mut cx);
    let execution_id = cx.argument::<JsString>(2)?.value(&mut cx);
    let task_token = cx.argument::<JsString>(3)?.value(&mut cx);
    let error_message = cx.argument::<JsString>(4)?.value(&mut cx);
    let stream_entry_id = cx
        .argument_opt(5)
        .and_then(|v| v.downcast::<JsString, _>(&mut cx).ok())
        .map(|s| s.value(&mut cx));

    // Get sender from RwLock (no async mutex needed - senders are Clone)
    let result_tx = {
        let guard = service_box.senders.read().unwrap();
        let senders = guard
            .as_ref()
            .ok_or_else(|| cx.throw_error::<_, ()>("Service not started").unwrap_err())?;
        senders.workflow_result_tx.clone()
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let task_token_bytes = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;

        let exec_result = ExecutionResult {
            run_id: execution_id.clone(),
            successful: false,
            commands: vec![],
            query_responses: vec![],
            update_results: vec![],
            error: Some(orcher_sdk_core::bridge::ExecutionError {
                message: error_message,
                error_type: orcher_sdk_core::bridge::ExecutionErrorType::WorkflowCode,
                details: None,
                retryable: false,
            }),
            restart_fresh: None,
        };

        let work_result = WorkflowWorkResult {
            workflow_id,
            run_id: execution_id,
            task_token: task_token_bytes,
            stream_entry_id,
            result: Ok(exec_result),
        };

        result_tx
            .send(work_result)
            .await
            .map_err(|e| format!("Failed to send result to sdk-core: {}", e))?;

        Ok(())
    })
}

// ============================================================================
// Fail task
// ============================================================================

/// Report a task as failed.
///
/// `errorType` and `nonRetryable` go to the engine with the failure; together with the
/// task's retry policy they decide whether the task is retried. Both are optional: without
/// them the failure is a generic, retryable one.
///
/// JavaScript signature:
/// ```typescript
/// function failTask(
///   service: ServiceHandle,
///   taskToken: string,
///   errorMessage: string,
///   errorType?: string,
///   nonRetryable?: boolean
/// ): Promise<void>;
/// ```
pub fn fail_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let task_token = cx.argument::<JsString>(1)?.value(&mut cx);
    let error_message = cx.argument::<JsString>(2)?.value(&mut cx);
    // Optional, so a caller that passes only the first three arguments still reports its
    // failure, as a generic retryable one.
    let error_type = match cx.argument_opt(3) {
        Some(v) if v.is_a::<JsString, _>(&mut cx) => {
            Some(v.downcast_or_throw::<JsString, _>(&mut cx)?.value(&mut cx))
        }
        _ => None,
    };
    let non_retryable = match cx.argument_opt(4) {
        Some(v) if v.is_a::<JsBoolean, _>(&mut cx) => {
            v.downcast_or_throw::<JsBoolean, _>(&mut cx)?.value(&mut cx)
        }
        _ => false,
    };
    let running = Arc::clone(&service_box.running_tasks);

    // Get sender from RwLock (no async mutex needed - senders are Clone)
    let result_tx = {
        let guard = service_box.senders.read().unwrap();
        let senders = guard
            .as_ref()
            .ok_or_else(|| cx.throw_error::<_, ()>("Service not started").unwrap_err())?;
        senders.task_result_tx.clone()
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let task_token_bytes = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;

        // The engine decides from the type and the non-retryable mark whether the task is
        // retried.
        let mut failure =
            orcher_sdk_core::TaskFailure::new(error_message).with_non_retryable(non_retryable);
        if let Some(error_type) = error_type {
            failure = failure.with_type(error_type);
        }
        let work_result = TaskWorkResult {
            task_token: task_token_bytes.clone(),
            result: Err(failure.into()),
        };

        // The task is released even if the send fails, so it is not heartbeated forever.
        let sent = result_tx.send(work_result).await;
        task_reported(&running, &task_token_bytes);
        sent.map_err(|e| format!("Failed to send result to sdk-core: {}", e))?;

        Ok(())
    })
}

// ============================================================================
// Shutdown
// ============================================================================

/// Tell the workflow and task drivers to stop, without waiting for them.
///
/// Call at the first sign of shutdown. The drivers start no new polls, but for their
/// shutdown grace period they still hand over what their outstanding polls bring back, and
/// wait for those results. So the workflow and task polling loops keep running until
/// `serviceShutdown` has returned and their slot channels close. Does nothing before
/// `serviceStart`.
///
/// JavaScript signature:
/// ```typescript
/// function serviceRequestShutdown(service: ServiceHandle): void;
/// ```
pub fn request_shutdown(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    // The handles are left in place: `shutdown` takes them to wait for the drivers.
    if let Some(stops) = service_box.driver_stops.lock().unwrap().as_ref() {
        stops.signal();
    }
    Ok(cx.undefined())
}

/// Shut the worker down gracefully.
///
/// Stops the workflow and task drivers and waits for each, up to `DRIVER_STOP_TIMEOUT`,
/// then stops the actor distributor and clears the senders and fan-out state. After it
/// returns, the poll and complete functions fail with "Service not started".
///
/// JavaScript signature:
/// ```typescript
/// function serviceShutdown(service: ServiceHandle): Promise<void>;
/// ```
pub fn shutdown(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let shutdown_tx_holder = service_box.shutdown_tx.clone();
    let driver_stops = service_box.driver_stops.lock().unwrap().take();
    let senders = service_box.senders.clone();
    let workflow_fan_out = service_box.workflow_fan_out.clone();
    let task_fan_out = service_box.task_fan_out.clone();
    let actor_fan_out = service_box.actor_fan_out.clone();

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        // Stop the workflow and task drivers and wait for both, before anything else. The
        // worker has already waited for its in-flight executions, so their results are
        // with the drivers. Stopped this way, each driver hands over what its last polls
        // bring back, waits for those results too, and sends everything it holds, all
        // within its shutdown grace period. Left running, or dropped mid-run, a driver
        // would abandon them, and each of those activations or tasks would stay claimed on
        // the engine until it timed out. The drivers are signalled here again in case
        // `serviceRequestShutdown` was not called; asking twice has no further effect.
        if let Some(stops) = driver_stops {
            stops.signal();
            let DriverStops { workflow, task } = stops;
            tokio::join!(
                await_driver("Workflow", workflow.1),
                await_driver("Task", task.1)
            );
        }

        // Stop the actor distributor only after the drivers have stopped. The workflow and
        // task distributors stop on their own, once their drivers have dropped their senders.
        {
            let guard = shutdown_tx_holder.lock().unwrap();
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(true);
            }
        }

        {
            let mut guard = senders.write().unwrap();
            *guard = None;
        }

        {
            let mut guard = workflow_fan_out.lock().await;
            *guard = None;
        }
        {
            let mut guard = task_fan_out.lock().await;
            *guard = None;
        }
        {
            let mut guard = actor_fan_out.lock().await;
            *guard = None;
        }

        log_info!("Service shutdown complete");
        Ok(())
    })
}

// ============================================================================
// Slot counts
// ============================================================================

/// The number of workflow polling slots set by `serviceStart` (0 before it).
///
/// JavaScript signature:
/// ```typescript
/// function getWorkflowSlotCount(service: ServiceHandle): number;
/// ```
pub fn get_workflow_slot_count(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let count = service_box.workflow_slot_count.load(Ordering::SeqCst);
    Ok(cx.number(count as f64))
}

/// The number of task polling slots set by `serviceStart` (0 before it).
///
/// JavaScript signature:
/// ```typescript
/// function getTaskSlotCount(service: ServiceHandle): number;
/// ```
pub fn get_task_slot_count(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let count = service_box.task_slot_count.load(Ordering::SeqCst);
    Ok(cx.number(count as f64))
}

// ============================================================================
// Session queues
// ============================================================================

/// Add a session queue, which the task driver starts polling immediately.
///
/// Throws before `serviceStart`.
///
/// JavaScript signature:
/// ```typescript
/// function addSessionQueue(service: ServiceHandle, queueName: string): void;
/// ```
pub fn add_session_queue(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let queue_name = cx.argument::<JsString>(1)?.value(&mut cx);

    let guard = service_box.session_queue_tx.lock().map_err(|e| {
        cx.throw_error::<_, ()>(format!("Lock poisoned: {}", e))
            .unwrap_err()
    })?;

    match guard.as_ref() {
        Some(tx) => {
            tx.send(SessionQueueChange::Add(queue_name)).map_err(|e| {
                cx.throw_error::<_, ()>(format!("Failed to send session queue add: {}", e))
                    .unwrap_err()
            })?;
            Ok(cx.undefined())
        }
        None => cx.throw_error("Session queue channel not initialized"),
    }
}

/// Remove a session queue, which the task driver stops polling.
///
/// Throws before `serviceStart`.
///
/// JavaScript signature:
/// ```typescript
/// function removeSessionQueue(service: ServiceHandle, queueName: string): void;
/// ```
pub fn remove_session_queue(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let queue_name = cx.argument::<JsString>(1)?.value(&mut cx);

    let guard = service_box.session_queue_tx.lock().map_err(|e| {
        cx.throw_error::<_, ()>(format!("Lock poisoned: {}", e))
            .unwrap_err()
    })?;

    match guard.as_ref() {
        Some(tx) => {
            tx.send(SessionQueueChange::Remove(queue_name))
                .map_err(|e| {
                    cx.throw_error::<_, ()>(format!("Failed to send session queue remove: {}", e))
                        .unwrap_err()
                })?;
            Ok(cx.undefined())
        }
        None => cx.throw_error("Session queue channel not initialized"),
    }
}

// ============================================================================
// Deprecated exports, kept for compatibility
// ============================================================================

/// Deprecated no-op, kept so callers that still register an error callback keep working.
///
/// Errors are returned directly by the poll and complete functions.
pub fn register_error_callback(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    Ok(cx.undefined())
}

// ============================================================================
// Task heartbeat and cancellation
// ============================================================================

/// Record a heartbeat from a running task's code.
///
/// The worker heartbeats every task it runs on its own. This call does not wait: the
/// record, with `details` when given, goes out with the next heartbeat due. Resolves
/// whether the task has been asked to stop; `cancelRequested` is `false` for a task this
/// worker is not running.
///
/// JavaScript signature:
/// ```typescript
/// function heartbeatTask(
///   service: ServiceHandle,
///   taskToken: string,   // base64-encoded task token
///   details?: string     // optional JSON progress details
/// ): Promise<{ cancelRequested: boolean }>;
/// ```
pub fn heartbeat_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let task_token = cx.argument::<JsString>(1)?.value(&mut cx);
    let details = cx
        .argument_opt(2)
        .and_then(|v| v.downcast::<JsString, _>(&mut cx).ok())
        .map(|s| s.value(&mut cx).into_bytes());
    let running = Arc::clone(&service_box.running_tasks);

    let runtime = Runtime::global();
    runtime.execute::<_, _, String>(&mut cx, async move {
        let token = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;
        let running = running.lock().unwrap_or_else(|p| p.into_inner());
        let cancel_requested = match running.get(&token) {
            Some(task) => {
                task.heartbeat.record(details);
                task.heartbeat.is_cancelled()
            }
            None => false,
        };
        Ok(serde_json::json!({ "cancelRequested": cancel_requested }).to_string())
    })
}

/// Wait until a running task is either asked to stop or reported.
///
/// Resolves `true` once the engine asks the task to stop (its workflow was canceled, or
/// the attempt is no longer running), and `false` once the task's outcome is reported.
/// Resolves `false` immediately for a task this worker is not running.
///
/// JavaScript signature:
/// ```typescript
/// function waitTaskCancelled(service: ServiceHandle, taskToken: string): Promise<boolean>;
/// ```
pub fn wait_task_cancelled(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let service_box = cx.argument::<JsBox<WorkerHandleType>>(0)?;
    let task_token = cx.argument::<JsString>(1)?.value(&mut cx);
    let running = Arc::clone(&service_box.running_tasks);

    let runtime = Runtime::global();
    runtime.execute::<_, bool, String>(&mut cx, async move {
        let token = base64::engine::general_purpose::STANDARD
            .decode(&task_token)
            .map_err(|e| format!("Invalid task token: {}", e))?;
        let watched = running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&token)
            .map(|task| (task.heartbeat.cancellation_token(), task.reported.clone()));
        let cancelled = match watched {
            Some((cancelled, reported)) => tokio::select! {
                _ = cancelled.cancelled() => true,
                _ = reported.cancelled() => false,
            },
            None => false,
        };
        Ok(cancelled)
    })
}

/// Deprecated: always rejects, directing callers to `serviceStart` and the poll functions.
pub fn service_run_with_handlers(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let runtime = Runtime::global();
    runtime.execute::<_, (), String>(&mut cx, async move {
        Err(
            "serviceRunWithHandlers is deprecated. Use serviceStart + pollWorkflowTask/pollTask instead."
                .to_string(),
        )
    })
}
