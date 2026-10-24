//! The worker, as a binding over sdk-core's worker host.
//!
//! The host runs one worker's plumbing: core's workflow, task and actor
//! drivers built from one configuration, the worker's registration and
//! heartbeats, sessions, and a draining shutdown. TypeScript pulls work from
//! it when it has room to run some, runs it, and hands back the outcome.
//!
//! Messages cross as their protobuf encoding (`orcher.kernel.v1` and
//! `orcher.host.v1`), as the host's encoded view gives and takes them, and
//! are decoded with protobuf-ts on the TypeScript side:
//!
//! - `hostNextActivation` / `hostCompleteActivation`: `RunActivation` and
//!   `RunActivationResult`.
//! - `hostNextTask` / `hostCompleteTask`: `TaskAssignment` and `TaskOutcome`,
//!   with `hostHeartbeat` and `hostTaskCancelled` for a running task.
//! - `hostNextActorOperation` / `hostCompleteActorOperation`:
//!   `ActorOperation` and `ActorResult`, with the actor state calls.
//!
//! A pull resolves `null` once the host has stopped and handed over
//! everything it took; it never wakes up empty-handed before then. Errors
//! cross tagged with their `ErrorCode` (see `error_code`).

use std::time::Duration;

use neon::prelude::*;
use neon::types::buffer::TypedArray;
use serde::Deserialize;

use orcher_sdk_core::proto::kernel::v1::Payload;
use orcher_sdk_core::{
    ActorHandler, EncodedHost, Host, HostConfig, Registrations, StateScope, TlsConfig,
};

use crate::error_code::{tagged, tagged_as};
use crate::runtime::{IntoJs, Runtime};

/// The running worker host JavaScript holds, boxed.
pub struct HostHandle {
    host: Host,
    /// The same host, giving and taking its messages encoded.
    encoded: EncodedHost,
}

impl Finalize for HostHandle {}

impl IntoJs for HostHandle {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.boxed(self).upcast())
    }
}

/// The worker's configuration, as `hostStart` reads it from JSON. Every
/// option left out keeps the host's default.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigJson {
    server_url: String,
    task_queue: String,
    namespace: String,
    identity: Option<String>,
    api_key: Option<String>,
    organization_id: Option<String>,
    version_id: Option<String>,
    tls: Option<TlsJson>,
    max_concurrent_workflows: Option<u32>,
    max_concurrent_tasks: Option<u32>,
    max_concurrent_actor_operations: Option<u32>,
    workflow_pollers: Option<usize>,
    task_pollers: Option<usize>,
    actor_pollers: Option<usize>,
    heartbeat_interval_ms: Option<u64>,
    max_sessions: Option<usize>,
    shutdown_grace_ms: Option<u64>,
    sdk_name: Option<String>,
    sdk_version: Option<String>,
}

/// TLS settings: the files to read, or none of them for TLS verified against
/// the system trust store.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TlsJson {
    ca_path: Option<String>,
    cert_path: Option<String>,
    key_path: Option<String>,
    reject_unauthorized: Option<bool>,
}

/// What the worker runs, as `hostStart` reads it from JSON.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationsJson {
    #[serde(default)]
    workflow_types: Vec<String>,
    #[serde(default)]
    task_types: Vec<String>,
    #[serde(default)]
    actor_handlers: Vec<ActorHandlerJson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActorHandlerJson {
    actor_name: String,
    operation: String,
    #[serde(default)]
    shared: bool,
}

fn read_file(what: &str, path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| {
        tagged_as(
            "INVALID_ARGUMENT",
            e,
            &format!("cannot read the {what} '{path}'"),
        )
    })
}

impl TlsJson {
    fn into_core(self) -> Result<TlsConfig, String> {
        // Certificate verification cannot be turned off by the transport;
        // the option is refused rather than ignored.
        if self.reject_unauthorized == Some(false) {
            return Err(tagged_as(
                "INVALID_ARGUMENT",
                "certificate verification cannot be disabled; supply the server's CA as \
                 tls.caPath instead",
                "tls.rejectUnauthorized: false is not supported",
            ));
        }
        let mut tls = TlsConfig::new();
        tls.ca_cert = self
            .ca_path
            .map(|p| read_file("CA certificate", &p))
            .transpose()?;
        tls.client_cert = self
            .cert_path
            .map(|p| read_file("client certificate", &p))
            .transpose()?;
        tls.client_key = self
            .key_path
            .map(|p| read_file("client key", &p))
            .transpose()?;
        Ok(tls)
    }
}

impl ConfigJson {
    fn into_host_config(self) -> Result<HostConfig, String> {
        let defaults = HostConfig::new(&self.server_url, &self.task_queue);
        let mut config = defaults
            .clone()
            .with_namespace(self.namespace)
            .with_concurrency(
                self.max_concurrent_workflows
                    .unwrap_or(defaults.max_concurrent_workflows),
                self.max_concurrent_tasks
                    .unwrap_or(defaults.max_concurrent_tasks),
                self.max_concurrent_actor_operations
                    .unwrap_or(defaults.max_concurrent_actor_operations),
            )
            .with_pollers(
                self.workflow_pollers.unwrap_or(defaults.workflow_pollers),
                self.task_pollers.unwrap_or(defaults.task_pollers),
                self.actor_pollers.unwrap_or(defaults.actor_pollers),
            )
            .with_sdk(
                self.sdk_name.unwrap_or_default(),
                self.sdk_version.unwrap_or_default(),
            )
            // A workflow failure is marked non-retryable only when the
            // workflow code raised it so (`answerActivation` in
            // `src/worker/activation.ts`).
            .with_protocol_version(orcher_sdk_core::worker_protocol::WORKFLOW_FAILURE_RETRYABILITY)
            // New runs take the kernel's step ids, random values and child
            // ids (`src/worker/activation.ts`); runs this SDK started before
            // keep its own.
            .with_step_ids([
                orcher_sdk_core::StepIdScheme::Kernel,
                orcher_sdk_core::StepIdScheme::TypescriptV0,
            ]);
        if let Some(identity) = self.identity {
            config = config.with_identity(identity);
        }
        if let Some(api_key) = self.api_key {
            config = config.with_api_key(api_key);
        }
        if let Some(organization_id) = self.organization_id {
            config = config.with_organization_id(organization_id);
        }
        if let Some(version_id) = self.version_id {
            config = config.with_version_id(version_id);
        }
        if let Some(tls) = self.tls {
            config = config.with_tls(tls.into_core()?);
        }
        if let Some(ms) = self.heartbeat_interval_ms {
            config = config.with_heartbeat_interval(Duration::from_millis(ms));
        }
        if let Some(max_sessions) = self.max_sessions {
            config = config.with_max_sessions(max_sessions);
        }
        if let Some(ms) = self.shutdown_grace_ms {
            config = config.with_shutdown_grace(Duration::from_millis(ms));
        }
        Ok(config)
    }
}

impl RegistrationsJson {
    fn into_registrations(self) -> Registrations {
        Registrations::new(self.workflow_types, self.task_types, [] as [&str; 0])
            .with_actor_handlers(self.actor_handlers.into_iter().map(|handler| {
                if handler.shared {
                    ActorHandler::shared(handler.actor_name, handler.operation)
                } else {
                    ActorHandler::exclusive(handler.actor_name, handler.operation)
                }
            }))
    }
}

/// The bytes of a `Buffer` or `Uint8Array` argument.
fn bytes_arg(cx: &mut FunctionContext, index: usize) -> NeonResult<Vec<u8>> {
    let value = cx.argument::<JsTypedArray<u8>>(index)?;
    Ok(value.as_slice(cx).to_vec())
}

/// The host a handle argument names.
fn host_arg(cx: &mut FunctionContext, index: usize) -> NeonResult<Host> {
    Ok(cx.argument::<JsBox<HostHandle>>(index)?.host.clone())
}

/// The encoded host a handle argument names.
fn encoded_arg(cx: &mut FunctionContext, index: usize) -> NeonResult<EncodedHost> {
    Ok(cx.argument::<JsBox<HostHandle>>(index)?.encoded.clone())
}

/// A host's refusal of an answer: `INVALID_ARGUMENT` for bytes that are not
/// the message, the error's own code otherwise.
fn refused(error: orcher_sdk_core::Error, context: &str) -> String {
    match error {
        orcher_sdk_core::Error::Protocol(_) => tagged_as("INVALID_ARGUMENT", error, context),
        error => tagged(&error, context),
    }
}

/// `hostStart(configJson: string, registrationsJson: string): Promise<HostHandle>`
///
/// Starts a worker: its drivers, its registration with the engine, and its
/// actor handlers' registration with the actor service. Rejects when nothing
/// is registered, the engine cannot be reached, a TLS file cannot be read, or
/// the actor service refuses the handlers.
pub fn host_start(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let config_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let registrations_json = cx.argument::<JsString>(1)?.value(&mut cx);
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        let config: ConfigJson = serde_json::from_str(&config_json)
            .map_err(|e| tagged_as("INVALID_ARGUMENT", e, "invalid worker configuration"))?;
        let registrations: RegistrationsJson = serde_json::from_str(&registrations_json)
            .map_err(|e| tagged_as("INVALID_ARGUMENT", e, "invalid worker registrations"))?;
        let host = Host::start(
            config.into_host_config()?,
            registrations.into_registrations(),
        )
        .await
        .map_err(|e| tagged(&e, "the worker could not start"))?;
        let encoded = host.encoded();
        Ok(HostHandle { host, encoded })
    })
}

/// `hostNextActivation(host): Promise<Buffer | null>`
///
/// The next workflow activation, an encoded `RunActivation`; `null` once the
/// worker has stopped and handed over every activation it took.
pub fn host_next_activation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    Runtime::global()
        .execute::<_, _, String>(&mut cx, async move { Ok(host.next_activation().await) })
}

/// `hostCompleteActivation(host, result: Uint8Array): Promise<void>`
///
/// Answers an activation with an encoded `RunActivationResult`.
pub fn host_complete_activation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    let bytes = bytes_arg(&mut cx, 1)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.complete_activation(&bytes)
            .await
            .map_err(|e| refused(e, "the activation's answer was not taken"))
    })
}

/// `hostNextTask(host): Promise<Buffer | null>`
///
/// The next task, an encoded `TaskAssignment`; `null` once the worker has
/// stopped and handed over every task it took.
pub fn host_next_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move { Ok(host.next_task().await) })
}

/// `hostHeartbeat(host, token: Uint8Array, details?: Uint8Array): { cancelRequested: boolean }`
///
/// Records a heartbeat from a running task's code, with its details (their
/// JSON encoding), sent with the next heartbeat due; says whether the task has
/// been asked to cancel.
pub fn host_heartbeat(mut cx: FunctionContext) -> JsResult<JsObject> {
    let host = host_arg(&mut cx, 0)?;
    let token = bytes_arg(&mut cx, 1)?;
    let details = match cx.argument_opt(2) {
        Some(value) if value.is_a::<JsTypedArray<u8>, _>(&mut cx) => {
            let array = value.downcast_or_throw::<JsTypedArray<u8>, _>(&mut cx)?;
            Some(Payload {
                data: array.as_slice(&cx).to_vec(),
                metadata: [("encoding".to_string(), b"json".to_vec())].into(),
                ..Default::default()
            })
        }
        _ => None,
    };
    let answer = host.heartbeat(&token, details);
    let object = cx.empty_object();
    let cancel_requested = cx.boolean(answer.cancel_requested);
    object.set(&mut cx, "cancelRequested", cancel_requested)?;
    Ok(object)
}

/// `hostTaskCancelled(host, token: Uint8Array): Promise<boolean>`
///
/// Resolves `true` once a running task is asked to cancel, and `false` once
/// its outcome is reported (at once for a task the host does not hold).
pub fn host_task_cancelled(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    let token = bytes_arg(&mut cx, 1)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        Ok(host.task_cancelled(&token).await)
    })
}

/// `hostCompleteTask(host, outcome: Uint8Array): Promise<void>`
///
/// Reports a task's outcome, an encoded `TaskOutcome`.
pub fn host_complete_task(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    let bytes = bytes_arg(&mut cx, 1)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.complete_task(&bytes)
            .await
            .map_err(|e| refused(e, "the task's outcome was not taken"))
    })
}

/// `hostNextActorOperation(host): Promise<Buffer | null>`
///
/// The next actor operation, an encoded `ActorOperation`; `null` once the
/// worker has stopped.
pub fn host_next_actor_operation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        Ok(host.next_actor_operation().await)
    })
}

/// `hostCompleteActorOperation(host, result: Uint8Array): Promise<void>`
///
/// Reports an actor operation's result, an encoded `ActorResult`.
pub fn host_complete_actor_operation(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = encoded_arg(&mut cx, 0)?;
    let bytes = bytes_arg(&mut cx, 1)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.complete_actor_operation(&bytes)
            .await
            .map_err(|e| refused(e, "the actor operation's result was not taken"))
    })
}

/// The actor state a call reads or writes: the three arguments after the
/// handle are the actor type, its key and the operation's execution id.
fn state_scope(cx: &mut FunctionContext) -> NeonResult<StateScope> {
    let actor_name = cx.argument::<JsString>(1)?.value(cx);
    let key = cx.argument::<JsString>(2)?.value(cx);
    let execution_id = cx.argument::<JsString>(3)?.value(cx);
    Ok(StateScope::new(actor_name, key, execution_id))
}

/// One key of an actor's state, as JavaScript receives it.
struct StateValueJs {
    value: Vec<u8>,
    version: String,
}

impl IntoJs for StateValueJs {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        let object = cx.empty_object();
        let value = JsBuffer::from_slice(cx, &self.value)?;
        object.set(cx, "value", value)?;
        let version = cx.string(self.version);
        object.set(cx, "version", version)?;
        Ok(object.upcast())
    }
}

/// `hostGetActorState(host, actorName, key, executionId, stateKey): Promise<{ value: Buffer, version: string } | null>`
///
/// `null` when the key is not set.
pub fn host_get_actor_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    let scope = state_scope(&mut cx)?;
    let state_key = cx.argument::<JsString>(4)?.value(&mut cx);
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        let value = host
            .get_actor_state(&scope, &state_key)
            .await
            .map_err(|e| tagged(&e, "reading actor state"))?;
        Ok(value.map(|value| StateValueJs {
            value: value.value,
            version: value.version,
        }))
    })
}

/// `hostSetActorState(host, actorName, key, executionId, stateKey, value: Uint8Array, expectedVersion?: string): Promise<string>`
///
/// Resolves the key's new version. With `expectedVersion`, the write is
/// refused unless the stored version is that one.
pub fn host_set_actor_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    let scope = state_scope(&mut cx)?;
    let state_key = cx.argument::<JsString>(4)?.value(&mut cx);
    let value = bytes_arg(&mut cx, 5)?;
    let expected_version = match cx.argument_opt(6) {
        Some(v) if v.is_a::<JsString, _>(&mut cx) => {
            Some(v.downcast_or_throw::<JsString, _>(&mut cx)?.value(&mut cx))
        }
        _ => None,
    };
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.set_actor_state(&scope, &state_key, value, expected_version.as_deref())
            .await
            .map_err(|e| tagged(&e, "writing actor state"))
    })
}

/// `hostDeleteActorState(host, actorName, key, executionId, stateKey): Promise<boolean>`
///
/// Resolves whether the key was set.
pub fn host_delete_actor_state(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    let scope = state_scope(&mut cx)?;
    let state_key = cx.argument::<JsString>(4)?.value(&mut cx);
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.delete_actor_state(&scope, &state_key)
            .await
            .map_err(|e| tagged(&e, "deleting actor state"))
    })
}

/// `hostActorStateKeys(host, actorName, key, executionId, prefix: string): Promise<string[]>`
pub fn host_actor_state_keys(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    let scope = state_scope(&mut cx)?;
    let prefix = cx.argument::<JsString>(4)?.value(&mut cx);
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.actor_state_keys(&scope, &prefix)
            .await
            .map_err(|e| tagged(&e, "listing actor state keys"))
    })
}

/// `hostShutdown(host): Promise<void>`
///
/// Stops the worker: it stops claiming work, gives the work running its
/// shutdown grace to finish, hands back the activations still unanswered,
/// closes its sessions and deregisters. Pulls then resolve `null`. A second
/// call resolves at once.
pub fn host_shutdown(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let host = host_arg(&mut cx, 0)?;
    Runtime::global().execute::<_, _, String>(&mut cx, async move {
        host.shutdown().await;
        Ok(())
    })
}

/// `hostWireMetrics(host) -> string`
///
/// The worker's measurements so far, as JSON: per gRPC method its calls,
/// status errors by code, transport errors, retries and latency, and the
/// activations and tasks it ran.
pub fn host_wire_metrics(mut cx: FunctionContext) -> JsResult<JsString> {
    let host = host_arg(&mut cx, 0)?;
    match serde_json::to_string(&host.wire_metrics()) {
        Ok(json) => Ok(cx.string(json)),
        Err(e) => cx.throw_error(format!("the measurements did not encode: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_configuration_maps_every_option_onto_the_host() {
        let config: ConfigJson = serde_json::from_str(
            r#"{
                "serverUrl": "http://localhost:50051",
                "taskQueue": "orders",
                "namespace": "shop",
                "identity": "worker-1",
                "apiKey": "key",
                "organizationId": "org",
                "versionId": "v7",
                "maxConcurrentWorkflows": 3,
                "maxConcurrentTasks": 4,
                "maxConcurrentActorOperations": 5,
                "workflowPollers": 6,
                "taskPollers": 7,
                "actorPollers": 8,
                "heartbeatIntervalMs": 1500,
                "maxSessions": 9,
                "shutdownGraceMs": 2500,
                "sdkName": "typescript",
                "sdkVersion": "1.2.3"
            }"#,
        )
        .unwrap();
        let config = config.into_host_config().unwrap();
        assert_eq!(config.connection.url, "http://localhost:50051");
        assert_eq!(config.task_queue, "orders");
        assert_eq!(config.connection.namespace, "shop");
        assert_eq!(config.identity, "worker-1");
        assert_eq!(config.connection.api_key.as_deref(), Some("key"));
        assert_eq!(config.connection.organization_id.as_deref(), Some("org"));
        assert_eq!(config.version_id.as_deref(), Some("v7"));
        assert!(config.connection.tls.is_none());
        assert_eq!(
            (
                config.max_concurrent_workflows,
                config.max_concurrent_tasks,
                config.max_concurrent_actor_operations
            ),
            (3, 4, 5)
        );
        assert_eq!(
            (
                config.workflow_pollers,
                config.task_pollers,
                config.actor_pollers
            ),
            (6, 7, 8)
        );
        assert_eq!(config.heartbeat_interval, Duration::from_millis(1500));
        assert_eq!(config.max_sessions, 9);
        assert_eq!(config.shutdown_grace, Duration::from_millis(2500));
        assert_eq!(
            (config.sdk_name.as_str(), config.sdk_version.as_str()),
            ("typescript", "1.2.3")
        );
    }

    #[test]
    fn unset_options_keep_the_host_defaults() {
        let config: ConfigJson = serde_json::from_str(
            r#"{ "serverUrl": "http://x:1", "taskQueue": "q", "namespace": "n", "versionId": " " }"#,
        )
        .unwrap();
        let config = config.into_host_config().unwrap();
        let defaults = HostConfig::new("http://x:1", "q");
        assert_eq!(
            config.max_concurrent_workflows,
            defaults.max_concurrent_workflows
        );
        assert_eq!(config.task_pollers, defaults.task_pollers);
        assert_eq!(config.shutdown_grace, defaults.shutdown_grace);
        assert!(config.identity.starts_with("orcher-worker-"));
        // A blank release is no release.
        assert!(config.version_id.is_none());
    }

    /// The worker reports that its workflow failures carry the mark the
    /// workflow code raised.
    #[test]
    fn the_worker_reports_meaningful_workflow_failure_marks() {
        let config: ConfigJson = serde_json::from_str(
            r#"{ "serverUrl": "http://x:1", "taskQueue": "q", "namespace": "n" }"#,
        )
        .unwrap();
        assert_eq!(
            config.into_host_config().unwrap().protocol_version,
            orcher_sdk_core::worker_protocol::WORKFLOW_FAILURE_RETRYABILITY
        );
    }

    #[test]
    fn an_empty_tls_object_means_tls_on_the_system_trust_store() {
        let config: ConfigJson = serde_json::from_str(
            r#"{ "serverUrl": "https://x:1", "taskQueue": "q", "namespace": "n", "tls": {} }"#,
        )
        .unwrap();
        let tls = config
            .into_host_config()
            .unwrap()
            .connection
            .tls
            .expect("tls");
        assert!(tls.ca_cert.is_none() && tls.client_cert.is_none());
    }

    #[test]
    fn turning_certificate_verification_off_is_refused() {
        let config: ConfigJson = serde_json::from_str(
            r#"{ "serverUrl": "https://x:1", "taskQueue": "q", "namespace": "n",
                 "tls": { "rejectUnauthorized": false } }"#,
        )
        .unwrap();
        let error = config.into_host_config().unwrap_err();
        assert!(error.starts_with("[INVALID_ARGUMENT]"), "{error}");
    }

    #[test]
    fn registrations_carry_actor_handlers_with_their_modes() {
        let registrations: RegistrationsJson = serde_json::from_str(
            r#"{ "workflowTypes": ["wf"], "taskTypes": ["t"],
                 "actorHandlers": [
                   { "actorName": "Cart", "operation": "add" },
                   { "actorName": "Cart", "operation": "total", "shared": true }
                 ] }"#,
        )
        .unwrap();
        let registrations = registrations.into_registrations();
        assert_eq!(registrations.workflow_types, ["wf"]);
        assert_eq!(registrations.task_types, ["t"]);
        assert_eq!(registrations.actor_types, ["Cart"]);
        assert_eq!(
            registrations.actor_handlers,
            [
                ActorHandler::exclusive("Cart", "add"),
                ActorHandler::shared("Cart", "total")
            ]
        );
    }
}
