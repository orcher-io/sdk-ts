//! Neon bindings for the workflow client and workflow handles.
//!
//! Failures reject with messages tagged by `error_code`, so the TypeScript side can map
//! them to its error classes.

use std::time::Duration;

use neon::prelude::*;

use crate::runtime::Runtime;

use orcher_sdk_core::client::{CancelWorkflowOpts, StartWorkflowOpts, WorkflowClient};
use orcher_sdk_core::types::{
    ListWorkflowsOptions, ListWorkflowsSortOrder, SearchWorkflowsOptions,
};

use crate::types::{get_optional_bool_property, get_optional_string_property, get_string_property};
use orcher_sdk_core::poller::TlsConfig;

/// Convert a millisecond duration to the proto `Duration` used in retry policies.
fn ms_to_proto_duration(ms: i64) -> orcher_sdk_core::proto::prost_types::Duration {
    orcher_sdk_core::proto::prost_types::Duration {
        seconds: ms / 1000,
        nanos: ((ms % 1000) * 1_000_000) as i32,
    }
}

/// Read an optional numeric property from a JS object.
fn get_number_property(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<f64>> {
    let v: Handle<JsValue> = obj.get(cx, key)?;
    if v.is_a::<JsNumber, _>(cx) {
        Ok(Some(v.downcast::<JsNumber, _>(cx).unwrap().value(cx)))
    } else {
        Ok(None)
    }
}

/// Read a millisecond duration from the first of `keys` that is present.
///
/// Start options are declared by two TypeScript interfaces that spell the timeout fields
/// differently, and reading only one spelling would silently discard the other. Keys are
/// tried in order, canonical name first.
fn get_duration_ms(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
    keys: &[&str],
) -> NeonResult<Option<Duration>> {
    for key in keys {
        if let Some(ms) = get_number_property(cx, obj, key)? {
            return Ok(Some(Duration::from_millis(ms as u64)));
        }
    }
    Ok(None)
}

/// Read an optional string-array property from a JS object.
fn get_string_array_property(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
    key: &str,
) -> NeonResult<Vec<String>> {
    let v: Handle<JsValue> = obj.get(cx, key)?;
    let Ok(arr) = v.downcast::<JsArray, _>(cx) else {
        return Ok(Vec::new());
    };
    let len = arr.len(cx);
    let mut out = Vec::with_capacity(len as usize);
    for i in 0..len {
        let item: Handle<JsValue> = arr.get(cx, i)?;
        if let Ok(s) = item.downcast::<JsString, _>(cx) {
            out.push(s.value(cx));
        }
    }
    Ok(out)
}

/// Parse the optional workflow-level `retryPolicy` from the JS start options.
///
/// Intervals are in milliseconds. `backoffCoefficient` defaults to 2 and `maxAttempts`
/// to 0. Returns `None` when `retryPolicy` is absent.
fn parse_retry_policy(
    cx: &mut FunctionContext,
    options: Handle<JsObject>,
) -> NeonResult<Option<orcher_sdk_core::proto::orcher::v1::RetryPolicy>> {
    let rp_val: Handle<JsValue> = options.get(cx, "retryPolicy")?;
    let Ok(rp) = rp_val.downcast::<JsObject, _>(cx) else {
        return Ok(None);
    };
    Ok(Some(orcher_sdk_core::proto::orcher::v1::RetryPolicy {
        initial_interval: get_number_property(cx, rp, "initialInterval")?
            .map(|ms| ms_to_proto_duration(ms as i64)),
        backoff_coefficient: get_number_property(cx, rp, "backoffCoefficient")?.unwrap_or(2.0),
        maximum_interval: get_number_property(cx, rp, "maxInterval")?
            .map(|ms| ms_to_proto_duration(ms as i64)),
        maximum_attempts: get_number_property(cx, rp, "maxAttempts")?.unwrap_or(0.0) as i32,
        non_retryable_error_types: get_string_array_property(cx, rp, "nonRetryableErrorTypes")?,
        ..Default::default()
    }))
}

// ============================================================================
// Handle types
// ============================================================================

/// The client handle JavaScript holds, boxed. Wraps sdk-core's `WorkflowClient`.
pub struct ClientHandleType {
    client: WorkflowClient,
    /// Server URL, used to open connections for actor invocations.
    pub server_url: String,
}

impl ClientHandleType {
    fn new(client: WorkflowClient, server_url: String) -> Self {
        Self { client, server_url }
    }

    fn client(&self) -> &WorkflowClient {
        &self.client
    }
}

impl crate::runtime::IntoJs for ClientHandleType {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.boxed(self).upcast())
    }
}

impl Finalize for ClientHandleType {
    fn finalize<'a, C: Context<'a>>(self, _cx: &mut C) {
        // Dropping `self` releases the WorkflowClient; nothing else to clean up.
    }
}

/// The workflow handle JavaScript holds, boxed. Wraps sdk-core's `WorkflowHandle`.
pub struct WorkflowHandleType {
    handle: orcher_sdk_core::client::WorkflowHandle,
}

impl WorkflowHandleType {
    fn new(handle: orcher_sdk_core::client::WorkflowHandle) -> Self {
        Self { handle }
    }

    fn handle(&self) -> &orcher_sdk_core::client::WorkflowHandle {
        &self.handle
    }
}

impl crate::runtime::IntoJs for WorkflowHandleType {
    fn into_js<'a, C: Context<'a>>(self, cx: &mut C) -> JsResult<'a, JsValue> {
        Ok(cx.boxed(self).upcast())
    }
}

impl Finalize for WorkflowHandleType {
    fn finalize<'a, C: Context<'a>>(self, _cx: &mut C) {
        // Dropping `self` releases the WorkflowHandle; nothing else to clean up.
    }
}

// ============================================================================
// Configuration
// ============================================================================

/// Client configuration read from the JavaScript config object.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ClientConfig {
    pub server_url: String,
    pub namespace: String,
    pub identity: Option<String>,
    /// Sent as `authorization: Bearer <key>` on every request.
    pub api_key: Option<String>,
    pub tls_config: Option<TlsConfig>,
}

impl ClientConfig {
    /// Read the config from a JavaScript object.
    ///
    /// Throws when `serverUrl` or `namespace` is missing, or the `tls` block is invalid.
    pub fn from_js<'a, C: Context<'a>>(cx: &mut C, obj: Handle<JsObject>) -> NeonResult<Self> {
        let server_url = get_string_property(cx, obj, "serverUrl")?;
        let namespace = get_string_property(cx, obj, "namespace")?;
        let identity = get_optional_string_property(cx, obj, "identity")?;
        let api_key = get_optional_string_property(cx, obj, "apiKey")?;
        let tls_config = parse_tls_config(cx, obj)?;

        Ok(Self {
            server_url,
            namespace,
            identity,
            api_key,
            tls_config,
        })
    }
}

/// Parse the TLS settings from a JavaScript client config object.
///
/// Reads the optional `tls` property, an object with:
/// - `caPath`: path to a CA certificate PEM file. Without it, the server is verified
///   against the system trust store.
/// - `certPath`, `keyPath`: paths to the client certificate and key PEM files, for mTLS.
/// - `rejectUnauthorized`: only `true` is accepted; `false` throws.
///
/// Returns `None` when `tls` is absent, which means plaintext.
fn parse_tls_config<'a, C: Context<'a>>(
    cx: &mut C,
    obj: Handle<JsObject>,
) -> NeonResult<Option<TlsConfig>> {
    let tls_value: Handle<JsValue> = obj.get(cx, "tls")?;
    if tls_value.is_a::<JsNull, _>(cx) || tls_value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }

    let tls_obj = tls_value
        .downcast::<JsObject, _>(cx)
        .or_else(|_| cx.throw_error("tls must be an object"))?;

    // Certificate verification cannot be turned off by the underlying transport.
    // Reject the request rather than accepting the option and ignoring it, which
    // would leave the caller believing verification was relaxed.
    if let Some(false) = get_optional_bool_property(cx, tls_obj, "rejectUnauthorized")? {
        return cx.throw_error(
            "tls.rejectUnauthorized: false is not supported — certificate verification \
             cannot be disabled. Supply the server's CA via tls.caPath instead \
             (e.g. for a self-signed development certificate).",
        );
    }

    // A missing caPath means "verify against the system trust store", not "no TLS".
    // Returning None here would be read as no TLS, so a tls block without a caPath (the
    // normal shape for mTLS against a publicly trusted server) would connect in plaintext
    // and send credentials in the clear.
    let ca_path = get_optional_string_property(cx, tls_obj, "caPath")?;
    let ca_cert = ca_path
        .map(|path| {
            std::fs::read(&path)
                .or_else(|e| cx.throw_error(format!("Failed to read CA cert '{}': {}", path, e)))
        })
        .transpose()?;

    let cert_path = get_optional_string_property(cx, tls_obj, "certPath")?;
    let key_path = get_optional_string_property(cx, tls_obj, "keyPath")?;

    let client_cert = cert_path
        .map(|p| {
            std::fs::read(&p)
                .or_else(|e| cx.throw_error(format!("Failed to read client cert '{}': {}", p, e)))
        })
        .transpose()?;

    let client_key = key_path
        .map(|p| {
            std::fs::read(&p)
                .or_else(|e| cx.throw_error(format!("Failed to read client key '{}': {}", p, e)))
        })
        .transpose()?;

    let mut tls = TlsConfig::new();
    tls.ca_cert = ca_cert;
    tls.client_cert = client_cert;
    tls.client_key = client_key;
    Ok(Some(tls))
}

// ============================================================================
// Connect
// ============================================================================

/// Connect to an Orcher server.
///
/// With a `tls` block, the connection uses TLS with a 5-second connect timeout and a
/// 180-second request timeout. `apiKey`, when given, is attached to every request.
///
/// JavaScript signature:
/// ```typescript
/// function clientConnect(config: {
///   serverUrl: string;
///   namespace: string;
///   identity?: string;
///   apiKey?: string;
///   tls?: { caPath?: string; certPath?: string; keyPath?: string;
///           rejectUnauthorized?: boolean };
/// }): Promise<ClientHandle>;
/// ```
pub fn connect(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let config_obj = cx.argument::<JsObject>(0)?;
    let config = ClientConfig::from_js(&mut cx, config_obj)?;

    let runtime = Runtime::global();
    let server_url = config.server_url.clone();
    let namespace = config.namespace.clone();
    let api_key = config.api_key.clone();

    let tls_config = config.tls_config.clone();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let client = if let Some(ref tls) = tls_config {
            // Without a custom CA, verify against the system trust store (for example,
            // mTLS to a publicly trusted server).
            let mut tls_cfg = match tls.ca_cert {
                Some(ref ca) => tonic::transport::ClientTlsConfig::new()
                    .ca_certificate(tonic::transport::Certificate::from_pem(ca)),
                None => tonic::transport::ClientTlsConfig::new().with_native_roots(),
            };

            if let (Some(ref cert), Some(ref key)) = (&tls.client_cert, &tls.client_key) {
                let identity = tonic::transport::Identity::from_pem(cert, key);
                tls_cfg = tls_cfg.identity(identity);
            }

            if let Some(ref domain) = tls.domain_name {
                tls_cfg = tls_cfg.domain_name(domain.clone());
            }

            let endpoint = tonic::transport::Endpoint::from_shared(server_url.clone())
                .map_err(|e| crate::error_code::tagged_as("CONNECTION_FAILED", e, "Invalid server URL"))?
                .tls_config(tls_cfg)
                .map_err(|e| crate::error_code::tagged_as("CONNECTION_FAILED", e, "TLS configuration error"))?
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(180));

            let channel = endpoint
                .connect()
                .await
                .map_err(|e| crate::error_code::tagged_as("CONNECTION_FAILED", e, "TLS connection failed"))?;

            WorkflowClient::from_channel(channel).with_namespace(&namespace)
        } else {
            WorkflowClient::connect(&server_url)
                .await
                .map_err(|e| crate::error_code::tagged(&e, "Client connection failed"))?
                .with_namespace(&namespace)
        };

        // Attach the API key here so every request from this client carries it.
        let client = match api_key {
            Some(ref key) => client.with_api_key(key.clone()),
            None => client,
        };

        tracing::info!(
            "Connected to ORCHER server: {} (namespace: {}, tls: {})",
            server_url,
            namespace,
            tls_config.is_some()
        );

        Ok(ClientHandleType::new(client, server_url))
    })
}

// ============================================================================
// Start workflow
// ============================================================================

/// Start a workflow and resolve to its handle.
///
/// Throws `[INVALID_ARGUMENT]` synchronously for an unknown `workflowIdReusePolicy`.
/// Timeouts are in milliseconds, and each accepts two spellings (see the body).
///
/// JavaScript signature:
/// ```typescript
/// function clientStartWorkflow(
///   client: ClientHandle,
///   options: {
///     workflowId: string;
///     workflowType: string;
///     taskQueue: string;
///     input?: any;
///     cronSchedule?: string;
///     retryPolicy?: {
///       initialInterval?: number; backoffCoefficient?: number; maxInterval?: number;
///       maxAttempts?: number; nonRetryableErrorTypes?: string[];
///     };
///     workflowExecutionTimeout?: number; // or workflowTimeout
///     workflowRunTimeout?: number;       // or runTimeout
///     workflowTaskTimeout?: number;      // or taskTimeout
///     workflowIdReusePolicy?: 'ALLOW_DUPLICATE' | 'ALLOW_DUPLICATE_FAILED_ONLY'
///       | 'REJECT_DUPLICATE' | 'TERMINATE_IF_RUNNING';
///   }
/// ): Promise<WorkflowHandle>;
/// ```
pub fn start_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;
    let client = &**client_box;

    let options = cx.argument::<JsObject>(1)?;
    let workflow_id = get_string_property(&mut cx, options, "workflowId")?;
    let workflow_type = get_string_property(&mut cx, options, "workflowType")?;
    let task_queue = get_string_property(&mut cx, options, "taskQueue")?;

    let input_value: Handle<JsValue> = options.get(&mut cx, "input")?;
    let input_json =
        if input_value.is_a::<JsUndefined, _>(&mut cx) || input_value.is_a::<JsNull, _>(&mut cx) {
            serde_json::Value::Null
        } else {
            crate::runtime::js_value_to_json(&mut cx, input_value)?
        };

    let cron_value: Handle<JsValue> = options.get(&mut cx, "cronSchedule")?;
    let cron_schedule = if cron_value.is_a::<JsString, _>(&mut cx) {
        Some(
            cron_value
                .downcast::<JsString, _>(&mut cx)
                .unwrap()
                .value(&mut cx),
        )
    } else {
        None
    };

    // Retry policy and timeouts are parsed here, before the async block, because the JS
    // context is not available inside it.
    //
    // Two `WorkflowStartOptions` interfaces reach this function: the one in
    // core/types.ts (`workflowTimeout`) and the one in client/types.ts
    // (`workflowExecutionTimeout`). Both spellings are accepted, because a name this layer
    // does not recognize would silently cost the caller their timeout and leave the
    // workflow running without a deadline.
    let retry_policy = parse_retry_policy(&mut cx, options)?;
    let execution_timeout = get_duration_ms(
        &mut cx,
        options,
        &["workflowExecutionTimeout", "workflowTimeout"],
    )?;
    let run_timeout = get_duration_ms(&mut cx, options, &["workflowRunTimeout", "runTimeout"])?;
    let task_timeout = get_duration_ms(&mut cx, options, &["workflowTaskTimeout", "taskTimeout"])?;

    // The reuse policy, by the TypeScript enum's values. An unknown value is refused
    // rather than ignored, because starting under a policy the caller did not ask for
    // would be a silent no-op.
    let policy_value: Handle<JsValue> = options.get(&mut cx, "workflowIdReusePolicy")?;
    let id_reuse_policy = if policy_value.is_a::<JsString, _>(&mut cx) {
        use orcher_sdk_core::proto::orcher::v1::WorkflowIdReusePolicy as Policy;
        let name = policy_value
            .downcast::<JsString, _>(&mut cx)
            .unwrap()
            .value(&mut cx);
        Some(match name.as_str() {
            "ALLOW_DUPLICATE" => Policy::AllowDuplicate,
            "ALLOW_DUPLICATE_FAILED_ONLY" => Policy::AllowDuplicateFailedOnly,
            "REJECT_DUPLICATE" => Policy::RejectDuplicate,
            "TERMINATE_IF_RUNNING" => Policy::TerminateIfRunning,
            other => {
                return cx.throw_error(format!(
                    "[INVALID_ARGUMENT] unknown workflowIdReusePolicy {other:?}"
                ))
            }
        })
    } else {
        None
    };

    let input_bytes = serde_json::to_vec(&input_json)
        .or_else(|e| cx.throw_error(format!("Failed to serialize input: {}", e)))?;

    let client_ref = client.client().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut opts = StartWorkflowOpts::new(
            workflow_id.clone(),
            workflow_type.clone(),
            task_queue.clone(),
            input_bytes,
        );
        opts.cron_schedule = cron_schedule;
        opts.retry_policy = retry_policy;
        opts.execution_timeout = execution_timeout;
        opts.run_timeout = run_timeout;
        opts.task_timeout = task_timeout;
        opts.id_reuse_policy = id_reuse_policy;

        let handle = client_ref
            .start_workflow_with_options(opts)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to start workflow"))?;

        tracing::info!(
            "Started workflow: {} (type: {}, queue: {})",
            workflow_id,
            workflow_type,
            task_queue
        );

        Ok(WorkflowHandleType::new(handle))
    })
}

/// The run id a handle names; empty for a handle that names only a workflow.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleRunId(handle: WorkflowHandle): string;
/// ```
pub fn workflow_handle_run_id(mut cx: FunctionContext) -> JsResult<JsString> {
    let handle = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let run_id = handle.handle().run_id().to_string();
    Ok(cx.string(run_id))
}

// ============================================================================
// Get workflow handle
// ============================================================================

/// Create a handle for an existing workflow, without calling the server.
///
/// JavaScript signature:
/// ```typescript
/// function clientGetWorkflowHandle(
///   client: ClientHandle,
///   workflowId: string,
///   runId?: string
/// ): WorkflowHandle;
/// ```
pub fn get_workflow_handle(mut cx: FunctionContext) -> JsResult<JsBox<WorkflowHandleType>> {
    let client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;
    let client = &**client_box;

    let workflow_id = cx.argument::<JsString>(1)?.value(&mut cx);

    let run_id = if cx.len() > 2 {
        let run_id_value = cx.argument::<JsValue>(2)?;
        if run_id_value.is_a::<JsString, _>(&mut cx) {
            Some(
                run_id_value
                    .downcast::<JsString, _>(&mut cx)
                    .unwrap()
                    .value(&mut cx),
            )
        } else {
            None
        }
    } else {
        None
    };

    // An empty run id means "the latest run of this workflow id", which the server
    // resolves, as it does for every other client that omits it. A caller who only knows
    // the workflow id (the common case: send an event to the workflow for order 123)
    // should not have to look up a run.
    let execution =
        orcher_sdk_core::types::WorkflowExecution::new(workflow_id, run_id.unwrap_or_default());
    let handle = orcher_sdk_core::client::WorkflowHandle::new(client.client().clone(), execution);

    tracing::debug!("Created workflow handle from execution");

    Ok(cx.boxed(WorkflowHandleType::new(handle)))
}

// ============================================================================
// Get workflow result
// ============================================================================

/// Wait for the workflow to finish and resolve to its result.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleGetResult(handle: WorkflowHandle): Promise<any>;
/// ```
pub fn get_workflow_result(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let json_value: serde_json::Value = handle_clone
            .result()
            .await
            .map_err(|e| crate::error_code::tagged_result(&e, "Failed to get workflow result"))?;

        Ok(json_value)
    })
}

// ============================================================================
// Cancel and terminate
// ============================================================================

/// The sdk-core options for a cancellation whose cleanup may take `cleanup_timeout`.
fn cancel_opts(cleanup_timeout: Option<Duration>) -> CancelWorkflowOpts {
    let opts = CancelWorkflowOpts::default();
    match cleanup_timeout {
        Some(timeout) => opts.with_cleanup_timeout(timeout),
        None => opts,
    }
}

/// Request cancellation of the workflow.
///
/// `options.cleanupTimeout` is how long, in milliseconds, the workflow may spend cleaning
/// up before the engine terminates it; absent, there is no limit. Engines from before
/// cancellation cleanup ignore it and cancel at once.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleCancel(
///   handle: WorkflowHandle,
///   options?: { cleanupTimeout?: number }
/// ): Promise<void>;
/// ```
pub fn cancel_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let cleanup_timeout = match cx.argument_opt(1) {
        Some(value) => match value.downcast::<JsObject, _>(&mut cx) {
            Ok(options) => get_duration_ms(&mut cx, options, &["cleanupTimeout"])?,
            Err(_) => None,
        },
        None => None,
    };
    let handle = &**handle_box;
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        handle_clone
            .cancel_with(cancel_opts(cleanup_timeout))
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to cancel workflow"))?;

        tracing::info!("Cancelled workflow");

        Ok(())
    })
}

/// Terminate the workflow. `reason` defaults to "Terminated by client".
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleTerminate(
///   handle: WorkflowHandle,
///   reason?: string
/// ): Promise<void>;
/// ```
pub fn terminate_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;

    let reason = if cx.len() > 1 {
        let reason_value = cx.argument::<JsValue>(1)?;
        if reason_value.is_a::<JsString, _>(&mut cx) {
            Some(
                reason_value
                    .downcast::<JsString, _>(&mut cx)
                    .unwrap()
                    .value(&mut cx),
            )
        } else {
            None
        }
    } else {
        None
    };

    let reason_str = reason.unwrap_or_else(|| "Terminated by client".to_string());
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        handle_clone
            .terminate(&reason_str)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to terminate workflow"))?;

        tracing::info!("Terminated workflow: {}", reason_str);

        Ok(())
    })
}

// ============================================================================
// Reset workflow
// ============================================================================

/// Reset the workflow to a journal event and re-execute from there.
///
/// Resolves to the new execution id. `reason` defaults to "Reset by client".
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleReset(
///   handle: WorkflowHandle,
///   targetEventId: number,
///   reason?: string
/// ): Promise<string>;
/// ```
pub fn reset_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;

    let target_event_id = cx.argument::<JsNumber>(1)?.value(&mut cx) as i64;

    let reason = if cx.len() > 2 {
        let reason_value = cx.argument::<JsValue>(2)?;
        if reason_value.is_a::<JsString, _>(&mut cx) {
            Some(
                reason_value
                    .downcast::<JsString, _>(&mut cx)
                    .unwrap()
                    .value(&mut cx),
            )
        } else {
            None
        }
    } else {
        None
    };

    let reason_str = reason.unwrap_or_else(|| "Reset by client".to_string());
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let new_execution_id = handle_clone
            .reset(target_event_id, &reason_str)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to reset workflow"))?;

        tracing::info!(
            "Reset workflow to event {}: {} (new execution {})",
            target_event_id,
            reason_str,
            new_execution_id
        );

        Ok(new_execution_id)
    })
}

// ============================================================================
// Query workflow
// ============================================================================

/// Query the workflow and resolve to the query result.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleQuery(
///   handle: WorkflowHandle,
///   queryName: string,
///   args?: unknown
/// ): Promise<unknown>;
/// ```
pub fn query_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;

    let query_name = cx.argument::<JsString>(1)?.value(&mut cx);

    let args_json = if cx.len() > 2 {
        let args_value = cx.argument::<JsValue>(2)?;
        if args_value.is_a::<JsUndefined, _>(&mut cx) || args_value.is_a::<JsNull, _>(&mut cx) {
            serde_json::Value::Null
        } else {
            crate::runtime::js_value_to_json(&mut cx, args_value)?
        }
    } else {
        serde_json::Value::Null
    };

    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let result: serde_json::Value = handle_clone
            .query(&query_name, args_json)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to query workflow"))?;

        Ok(result)
    })
}

// ============================================================================
// Update workflow
// ============================================================================

/// Send an update to the workflow and resolve to the update result.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleUpdate(
///   handle: WorkflowHandle,
///   updateName: string,
///   args?: unknown
/// ): Promise<unknown>;
/// ```
pub fn update_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;

    let update_name = cx.argument::<JsString>(1)?.value(&mut cx);

    let args_json = if cx.len() > 2 {
        let args_value = cx.argument::<JsValue>(2)?;
        if args_value.is_a::<JsUndefined, _>(&mut cx) || args_value.is_a::<JsNull, _>(&mut cx) {
            serde_json::Value::Null
        } else {
            crate::runtime::js_value_to_json(&mut cx, args_value)?
        }
    } else {
        serde_json::Value::Null
    };

    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let result: serde_json::Value = handle_clone
            .update(&update_name, args_json)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to update workflow"))?;

        Ok(result)
    })
}

// ============================================================================
// Send event
// ============================================================================

/// Send a named event, with an optional payload, to the workflow.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleSendEvent(
///   handle: WorkflowHandle,
///   eventName: string,
///   payload?: unknown
/// ): Promise<void>;
/// ```
pub fn send_event(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;

    let event_name = cx.argument::<JsString>(1)?.value(&mut cx);

    let payload_json = if cx.len() > 2 {
        let payload_value = cx.argument::<JsValue>(2)?;
        if payload_value.is_a::<JsUndefined, _>(&mut cx) || payload_value.is_a::<JsNull, _>(&mut cx)
        {
            serde_json::Value::Null
        } else {
            crate::runtime::js_value_to_json(&mut cx, payload_value)?
        }
    } else {
        serde_json::Value::Null
    };

    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        handle_clone
            .send_event(&event_name, payload_json)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to send event to workflow"))?;

        Ok(())
    })
}

// ============================================================================
// Get status
// ============================================================================

/// Resolve to the workflow's status, as a `WorkflowStatus` enum value string.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleGetStatus(handle: WorkflowHandle): Promise<string>;
/// ```
pub fn get_status(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let status = handle_clone
            .status()
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to get workflow status"))?;

        Ok(serde_json::Value::String(status.to_string()))
    })
}

// ============================================================================
// Describe workflow
// ============================================================================

/// Resolve to the workflow execution's description (detailed metadata) as an object.
///
/// JavaScript signature:
/// ```typescript
/// function workflowHandleDescribe(handle: WorkflowHandle): Promise<object>;
/// ```
pub fn describe_workflow(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle_box = cx.argument::<JsBox<WorkflowHandleType>>(0)?;
    let handle = &**handle_box;
    let handle_clone = handle.handle().clone();
    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let description = handle_clone
            .describe()
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to describe workflow"))?;

        // `IntoJs` turns the serde_json::Value into a plain JS object.
        let json_value = serde_json::to_value(&description)
            .map_err(|e| crate::error_code::tagged_as("INTERNAL", e, "Failed to serialize description"))?;

        Ok(json_value)
    })
}

// ============================================================================
// List workflows
// ============================================================================

/// List workflow executions, one page at a time.
///
/// `pageSize` defaults to 100. Unrecognized `statusFilter` entries and `sortOrder`
/// values are ignored. `CANCELED` and `CANCELLED` are both accepted.
///
/// JavaScript signature:
/// ```typescript
/// function clientListWorkflows(
///   client: ClientHandle,
///   options: {
///     pageSize?: number;
///     nextPageToken?: number[];
///     workflowType?: string;
///     taskQueue?: string;
///     statusFilter?: string[]; // e.g. 'RUNNING', 'COMPLETED', 'TIMED_OUT'
///     sortOrder?: 'START_TIME_ASC' | 'START_TIME_DESC' | 'CLOSE_TIME_ASC'
///       | 'CLOSE_TIME_DESC';
///   }
/// ): Promise<object>;
/// ```
pub fn list_workflows(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;
    let client = &**client_box;
    let client_ref = client.client().clone();

    let options_obj = cx.argument::<JsObject>(1)?;

    let page_size_val: Handle<JsValue> = options_obj.get(&mut cx, "pageSize")?;
    let page_size = if page_size_val.is_a::<JsNumber, _>(&mut cx) {
        page_size_val
            .downcast::<JsNumber, _>(&mut cx)
            .unwrap()
            .value(&mut cx) as i32
    } else {
        100
    };

    // The page token arrives as an array of byte values.
    let token_val: Handle<JsValue> = options_obj.get(&mut cx, "nextPageToken")?;
    let next_page_token = if token_val.is_a::<JsArray, _>(&mut cx) {
        let arr = token_val.downcast::<JsArray, _>(&mut cx).unwrap();
        let len = arr.len(&mut cx);
        let mut bytes = Vec::with_capacity(len as usize);
        for i in 0..len {
            let v: Handle<JsValue> = arr.get(&mut cx, i)?;
            if let Ok(n) = v.downcast::<JsNumber, _>(&mut cx) {
                bytes.push(n.value(&mut cx) as u8);
            }
        }
        bytes
    } else {
        vec![]
    };

    let wf_type_val: Handle<JsValue> = options_obj.get(&mut cx, "workflowType")?;
    let workflow_type = if wf_type_val.is_a::<JsString, _>(&mut cx) {
        Some(
            wf_type_val
                .downcast::<JsString, _>(&mut cx)
                .unwrap()
                .value(&mut cx),
        )
    } else {
        None
    };

    let tq_val: Handle<JsValue> = options_obj.get(&mut cx, "taskQueue")?;
    let task_queue = if tq_val.is_a::<JsString, _>(&mut cx) {
        Some(
            tq_val
                .downcast::<JsString, _>(&mut cx)
                .unwrap()
                .value(&mut cx),
        )
    } else {
        None
    };

    let status_val: Handle<JsValue> = options_obj.get(&mut cx, "statusFilter")?;
    let status_filter = if status_val.is_a::<JsArray, _>(&mut cx) {
        let arr = status_val.downcast::<JsArray, _>(&mut cx).unwrap();
        let len = arr.len(&mut cx);
        let mut statuses = Vec::new();
        for i in 0..len {
            let v: Handle<JsValue> = arr.get(&mut cx, i)?;
            if let Ok(s) = v.downcast::<JsString, _>(&mut cx) {
                let status_str = s.value(&mut cx);
                let status = match status_str.as_str() {
                    "RUNNING" => Some(orcher_sdk_core::WorkflowStatus::Running),
                    "COMPLETED" => Some(orcher_sdk_core::WorkflowStatus::Completed),
                    "FAILED" => Some(orcher_sdk_core::WorkflowStatus::Failed),
                    "CANCELLED" | "CANCELED" => Some(orcher_sdk_core::WorkflowStatus::Cancelled),
                    "TERMINATED" => Some(orcher_sdk_core::WorkflowStatus::Terminated),
                    "TIMED_OUT" => Some(orcher_sdk_core::WorkflowStatus::TimedOut),
                    "RESTARTED_FRESH" => Some(orcher_sdk_core::WorkflowStatus::RestartedFresh),
                    _ => None,
                };
                if let Some(s) = status {
                    statuses.push(s);
                }
            }
        }
        statuses
    } else {
        vec![]
    };

    let sort_val: Handle<JsValue> = options_obj.get(&mut cx, "sortOrder")?;
    let sort_order = if sort_val.is_a::<JsString, _>(&mut cx) {
        let s = sort_val
            .downcast::<JsString, _>(&mut cx)
            .unwrap()
            .value(&mut cx);
        match s.as_str() {
            "START_TIME_ASC" => Some(ListWorkflowsSortOrder::StartTimeAsc),
            "START_TIME_DESC" => Some(ListWorkflowsSortOrder::StartTimeDesc),
            "CLOSE_TIME_ASC" => Some(ListWorkflowsSortOrder::CloseTimeAsc),
            "CLOSE_TIME_DESC" => Some(ListWorkflowsSortOrder::CloseTimeDesc),
            _ => None,
        }
    } else {
        None
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let mut options = ListWorkflowsOptions::default()
            .with_page_size(page_size)
            .with_next_page_token(next_page_token)
            .with_status_filter(status_filter);
        options.workflow_type = workflow_type;
        options.task_queue = task_queue;
        options.sort_order = sort_order;

        let page = client_ref
            .list_workflows(options)
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to list workflows"))?;

        let json_value = serde_json::to_value(&page)
            .map_err(|e| crate::error_code::tagged_as("INTERNAL", e, "Failed to serialize list result"))?;

        Ok(json_value)
    })
}

// ============================================================================
// Search workflows
// ============================================================================

/// Search workflow executions with a query string, one page at a time.
///
/// `pageSize` defaults to 100.
///
/// JavaScript signature:
/// ```typescript
/// function clientSearchWorkflows(
///   client: ClientHandle,
///   query: string,
///   options: { pageSize?: number; nextPageToken?: number[] }
/// ): Promise<object>;
/// ```
pub fn search_workflows(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;
    let client = &**client_box;
    let client_ref = client.client().clone();

    let query = cx.argument::<JsString>(1)?.value(&mut cx);

    let options_obj = cx.argument::<JsObject>(2)?;

    let page_size_val: Handle<JsValue> = options_obj.get(&mut cx, "pageSize")?;
    let page_size = if page_size_val.is_a::<JsNumber, _>(&mut cx) {
        page_size_val
            .downcast::<JsNumber, _>(&mut cx)
            .unwrap()
            .value(&mut cx) as i32
    } else {
        100
    };

    let token_val: Handle<JsValue> = options_obj.get(&mut cx, "nextPageToken")?;
    let next_page_token = if token_val.is_a::<JsArray, _>(&mut cx) {
        let arr = token_val.downcast::<JsArray, _>(&mut cx).unwrap();
        let len = arr.len(&mut cx);
        let mut bytes = Vec::with_capacity(len as usize);
        for i in 0..len {
            let v: Handle<JsValue> = arr.get(&mut cx, i)?;
            if let Ok(n) = v.downcast::<JsNumber, _>(&mut cx) {
                bytes.push(n.value(&mut cx) as u8);
            }
        }
        bytes
    } else {
        vec![]
    };

    let runtime = Runtime::global();

    runtime.execute::<_, _, String>(&mut cx, async move {
        let page = client_ref
            .search_workflows(
                query,
                SearchWorkflowsOptions::default()
                    .with_page_size(page_size)
                    .with_next_page_token(next_page_token),
            )
            .await
            .map_err(|e| crate::error_code::tagged(&e, "Failed to search workflows"))?;

        let json_value = serde_json::to_value(&page)
            .map_err(|e| crate::error_code::tagged_as("INTERNAL", e, "Failed to serialize search result"))?;

        Ok(json_value)
    })
}

// ============================================================================
// Close
// ============================================================================

/// Log that the client is closed.
///
/// This releases nothing itself: the connection is freed when JavaScript drops the
/// handle and it is garbage-collected.
///
/// JavaScript signature:
/// ```typescript
/// function clientClose(client: ClientHandle): void;
/// ```
pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let _client_box = cx.argument::<JsBox<ClientHandleType>>(0)?;

    tracing::info!("Closed client connection");

    Ok(cx.undefined())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancellation_sets_no_cleanup_limit_by_default() {
        assert_eq!(cancel_opts(None).cleanup_timeout, None);
    }

    #[test]
    fn a_cancellation_passes_its_cleanup_limit_to_sdk_core() {
        assert_eq!(
            cancel_opts(Some(Duration::from_millis(90_500))).cleanup_timeout,
            Some(Duration::from_millis(90_500))
        );
    }
}
