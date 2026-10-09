//! Neon N-API binding that exposes Orcher SDK Core to the TypeScript SDK.
//!
//! ```text
//! TypeScript (@orcher/sdk)
//!     ↓
//! Neon (this crate, loaded as orcher_core.node)
//!     ↓
//! orcher-sdk-core (Rust)
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

mod actor;
mod client;
mod error_code;
mod codec;
mod error;
mod journal_times;
mod runtime;
mod worker;
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

    // Worker ("service" in the exported names)
    cx.export_function("serviceCreate", worker::create)?;
    cx.export_function("serviceStart", worker::start)?;
    cx.export_function("serviceShutdown", worker::shutdown)?;
    cx.export_function("serviceRequestShutdown", worker::request_shutdown)?;

    // Pull-model polling and completion. Each TypeScript polling loop passes its own
    // slot index, so loops poll in parallel.
    cx.export_function("pollWorkflowTask", worker::poll_workflow_task)?;
    cx.export_function("pollTask", worker::poll_task)?;
    cx.export_function("completeWorkflowTask", worker::complete_workflow_task)?;
    cx.export_function("completeTask", worker::complete_task)?;
    cx.export_function("failWorkflowTask", worker::fail_workflow_task)?;
    cx.export_function("failTask", worker::fail_task)?;
    cx.export_function("heartbeatTask", worker::heartbeat_task)?;
    cx.export_function("waitTaskCancelled", worker::wait_task_cancelled)?;

    // Slot counts, which tell TypeScript how many polling loops to start.
    cx.export_function("getWorkflowSlotCount", worker::get_workflow_slot_count)?;
    cx.export_function("getTaskSlotCount", worker::get_task_slot_count)?;

    // Session queues
    cx.export_function("addSessionQueue", worker::add_session_queue)?;
    cx.export_function("removeSessionQueue", worker::remove_session_queue)?;

    // Deprecated, kept for compatibility: one is a no-op, the other always rejects.
    cx.export_function("serviceRunWithHandlers", worker::service_run_with_handlers)?;
    cx.export_function(
        "serviceRegisterErrorCallback",
        worker::register_error_callback,
    )?;

    // Actors
    cx.export_function("registerActorHandlers", actor::register_actor_handlers)?;
    cx.export_function("pollActorOperation", actor::poll_actor_operation)?;
    cx.export_function("completeActorOperation", actor::complete_actor_operation)?;
    cx.export_function(
        "clientInvokeActorOperation",
        actor::client_invoke_actor_operation,
    )?;
    cx.export_function("actorGetState", actor::actor_get_state)?;
    cx.export_function("actorSetState", actor::actor_set_state)?;
    cx.export_function("actorDeleteState", actor::actor_delete_state)?;
    cx.export_function("actorListStateKeys", actor::actor_list_state_keys)?;

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
