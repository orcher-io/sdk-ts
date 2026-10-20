//! Neon N-API binding that exposes Orcher SDK Core to the TypeScript SDK.
//!
//! ```text
//! TypeScript (@orcher/sdk)
//!     ↓
//! Neon (this crate, loaded as orcher_core.node)
//!     ↓
//! orcher-sdk-host (the worker)    orcher-sdk-core (the client, codecs, the kernel)
//! ```
//!
//! The functions exported in `main` are the whole JavaScript surface of the binding.

// Protocol messages are built with `..Default::default()` even when every
// field is set today: a field added to the protocol then leaves an older
// release of this crate building, sending the field unset.
#![allow(clippy::needless_update)]

use neon::prelude::*;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tracing_subscriber::{fmt, EnvFilter};

mod client;
mod codec;
mod error;
mod error_code;
mod host;
mod kernel;
mod runtime;
mod types;
mod utils;

/// Whether `initialize` has run in this process.
static INITIALIZED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

/// Set up tracing once per process. Called when the module is loaded.
///
/// The filter comes from `RUST_LOG` when set, and otherwise logs this crate and
/// sdk-core at info level.
fn initialize() {
    let mut initialized = INITIALIZED.lock().unwrap();
    if *initialized {
        return;
    }

    // `try_init` fails if a subscriber is already installed; that is not an error here.
    let _ = fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("orcher_core=info,orcher_sdk_core=info")),
        )
        .try_init();

    tracing::info!("ORCHER Core Native module initialized");
    *initialized = true;
}

/// The version of this crate.
fn version(mut cx: FunctionContext) -> JsResult<JsString> {
    let version = env!("CARGO_PKG_VERSION");
    Ok(cx.string(version))
}

/// The version of the linked orcher-sdk-core.
fn ffi_version(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string(orcher_sdk_core::VERSION))
}

/// Always `true`: sdk-core is linked in, so it is reachable whenever the module loads.
fn health_check(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    Ok(cx.boolean(true))
}

/// Always `"direct-bindings"`, the only mode this binding has.
fn get_runtime_mode(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string("direct-bindings"))
}

/// Neon entry point: initializes the module and exports its functions to JavaScript.
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    initialize();

    cx.export_function("version", version)?;
    cx.export_function("ffiVersion", ffi_version)?;
    cx.export_function("healthCheck", health_check)?;
    cx.export_function("getRuntimeMode", get_runtime_mode)?;

    // Client
    cx.export_function("clientConnect", client::connect)?;
    cx.export_function("clientStartWorkflow", client::start_workflow)?;
    cx.export_function("clientGetWorkflowHandle", client::get_workflow_handle)?;
    cx.export_function("clientListWorkflows", client::list_workflows)?;
    cx.export_function("clientSearchWorkflows", client::search_workflows)?;
    cx.export_function("clientClose", client::close)?;

    // The worker: a binding over the worker host. Work crosses as protobuf.
    cx.export_function("hostStart", host::host_start)?;
    cx.export_function("hostNextActivation", host::host_next_activation)?;
    cx.export_function("hostCompleteActivation", host::host_complete_activation)?;
    cx.export_function("hostNextTask", host::host_next_task)?;
    cx.export_function("hostHeartbeat", host::host_heartbeat)?;
    cx.export_function("hostTaskCancelled", host::host_task_cancelled)?;
    cx.export_function("hostCompleteTask", host::host_complete_task)?;
    cx.export_function("hostNextActorOperation", host::host_next_actor_operation)?;
    cx.export_function(
        "hostCompleteActorOperation",
        host::host_complete_actor_operation,
    )?;
    cx.export_function("hostGetActorState", host::host_get_actor_state)?;
    cx.export_function("hostSetActorState", host::host_set_actor_state)?;
    cx.export_function("hostDeleteActorState", host::host_delete_actor_state)?;
    cx.export_function("hostActorStateKeys", host::host_actor_state_keys)?;
    cx.export_function("hostShutdown", host::host_shutdown)?;
    cx.export_function("hostWireMetrics", host::host_wire_metrics)?;

    // Actors, client side
    cx.export_function(
        "clientInvokeActorOperation",
        client::client_invoke_actor_operation,
    )?;

    // Workflow handles
    cx.export_function("workflowHandleGetResult", client::get_workflow_result)?;
    cx.export_function("workflowHandleCancel", client::cancel_workflow)?;
    cx.export_function("workflowHandleTerminate", client::terminate_workflow)?;
    cx.export_function("workflowHandleReset", client::reset_workflow)?;
    cx.export_function("workflowHandleQuery", client::query_workflow)?;
    cx.export_function("workflowHandleUpdate", client::update_workflow)?;
    cx.export_function("workflowHandleSendEvent", client::send_event)?;
    cx.export_function("workflowHandleGetStatus", client::get_status)?;
    cx.export_function("workflowHandleDescribe", client::describe_workflow)?;
    cx.export_function("workflowHandleRunId", client::workflow_handle_run_id)?;

    // Payload codecs
    cx.export_function("codecGzipCreate", codec::codec_gzip_create)?;
    cx.export_function("codecGzipEncode", codec::codec_gzip_encode)?;
    cx.export_function("codecGzipDecode", codec::codec_gzip_decode)?;
    cx.export_function("codecEncryptionCreate", codec::codec_encryption_create)?;
    cx.export_function(
        "codecEncryptionGenerateKey",
        codec::codec_encryption_generate_key,
    )?;
    cx.export_function("codecEncryptionEncode", codec::codec_encryption_encode)?;
    cx.export_function("codecEncryptionDecode", codec::codec_encryption_decode)?;
    cx.export_function("codecChainCreate", codec::codec_chain_create)?;
    cx.export_function("codecChainAddGzip", codec::codec_chain_add_gzip)?;
    cx.export_function("codecChainAddEncryption", codec::codec_chain_add_encryption)?;
    cx.export_function("codecChainEncode", codec::codec_chain_encode)?;
    cx.export_function("codecChainDecode", codec::codec_chain_decode)?;
    cx.export_function("codecChainLen", codec::codec_chain_len)?;

    // The kernel protocol, for replaying recorded activations without an
    // engine (contract/replay-check.ts).
    cx.export_function("kernelResolve", kernel::kernel_resolve)?;
    cx.export_function("kernelExecutionResult", kernel::kernel_execution_result)?;

    tracing::info!("ORCHER Core Native module loaded successfully");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialization() {
        initialize();
        let initialized = INITIALIZED.lock().unwrap();
        assert!(*initialized);
    }

    #[test]
    fn test_version() {
        let version = env!("CARGO_PKG_VERSION");
        assert!(!version.is_empty());
    }
}
