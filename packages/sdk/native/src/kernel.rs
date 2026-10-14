//! The kernel protocol (`orcher.kernel.v1`) as TypeScript reaches it.
//!
//! The worker does not use these yet: it still runs activations from the jobs
//! sdk-core derives from the journal. They let a recorded activation be run
//! both ways without an engine, so the TypeScript path that runs a
//! `RunActivation` can be checked against the one the worker uses:
//!
//! - `kernelResolve`: a recorded activation, resolved by the kernel.
//! - `legacyExecutionRequest`: the same activation as the worker hands it to
//!   TypeScript today.
//! - `kernelExecutionResult`: TypeScript's `RunActivationResult`, as the
//!   result the workflow driver checks and sends.
//! - `legacyExecutionResult`: the result TypeScript answers with today, as the
//!   worker reads it.
//!
//! Messages cross as their protobuf encoding; results as JSON.

use neon::prelude::*;
use neon::types::buffer::TypedArray;

use orcher_sdk_core::bridge::ExecutionResult;
use orcher_sdk_core::proto::kernel::v1::RunActivationResult;
use orcher_sdk_core::proto::orcher::v1::PollWorkflowExecutionResponse;
use orcher_sdk_core::proto::prost::Message;
use orcher_sdk_core::WorkflowExecutionTask;

use crate::worker::execution_request_json;

/// The workflow task a recorded activation (an encoded
/// `orcher.v1.PollWorkflowExecutionResponse`) carries.
fn recorded_task<'a>(
    cx: &mut FunctionContext<'a>,
    bytes: &[u8],
) -> NeonResult<WorkflowExecutionTask> {
    match PollWorkflowExecutionResponse::decode(bytes) {
        Ok(response) => Ok(WorkflowExecutionTask::from(response)),
        Err(e) => cx.throw_error(format!("not a recorded activation: {e}")),
    }
}

/// `kernelResolve(pollResponse: Buffer, namespace: string): Buffer`
///
/// The activation's history resolved by the kernel, as an encoded
/// `orcher.kernel.v1.RunActivation`.
pub fn kernel_resolve(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let bytes = cx.argument::<JsBuffer>(0)?.as_slice(&cx).to_vec();
    let namespace = cx.argument::<JsString>(1)?.value(&mut cx);
    let task = recorded_task(&mut cx, &bytes)?;
    let activation = orcher_sdk_core::kernel::resolve(&task, &namespace);
    JsBuffer::from_slice(&mut cx, &activation.encode_to_vec())
}

/// `legacyExecutionRequest(pollResponse: Buffer): string`
///
/// The activation as the worker hands it to TypeScript today: the JSON of the
/// execution request, with the journal's times.
pub fn legacy_execution_request(mut cx: FunctionContext) -> JsResult<JsString> {
    let bytes = cx.argument::<JsBuffer>(0)?.as_slice(&cx).to_vec();
    let task = recorded_task(&mut cx, &bytes)?;
    match execution_request_json(&task) {
        Ok(request) => Ok(cx.string(request.to_string())),
        Err(e) => cx.throw_error(e),
    }
}

/// `kernelExecutionResult(runId: string, result: Buffer): string`
///
/// An encoded `orcher.kernel.v1.RunActivationResult`, as the JSON of the
/// result the workflow driver checks and sends. Throws when the kernel refuses
/// it (a protocol error).
pub fn kernel_execution_result(mut cx: FunctionContext) -> JsResult<JsString> {
    let run_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let bytes = cx.argument::<JsBuffer>(1)?.as_slice(&cx).to_vec();
    let answer = match RunActivationResult::decode(bytes.as_slice()) {
        Ok(answer) => answer,
        Err(e) => return cx.throw_error(format!("not a RunActivationResult: {e}")),
    };
    let result = match orcher_sdk_core::kernel::execution_result(&run_id, answer) {
        Ok(result) => result,
        Err(e) => return cx.throw_error(e.to_string()),
    };
    match serde_json::to_string(&result) {
        Ok(json) => Ok(cx.string(json)),
        Err(e) => cx.throw_error(e.to_string()),
    }
}

/// `legacyExecutionResult(resultJson: string): string`
///
/// The JSON TypeScript answers an activation with today, read as the worker
/// reads it (`completeWorkflowTask`) and written back, so it compares with
/// `kernelExecutionResult` field for field.
pub fn legacy_execution_result(mut cx: FunctionContext) -> JsResult<JsString> {
    let json = cx.argument::<JsString>(0)?.value(&mut cx);
    let result: ExecutionResult = match serde_json::from_str(&json) {
        Ok(result) => result,
        Err(e) => return cx.throw_error(format!("Invalid result JSON: {e}")),
    };
    match serde_json::to_string(&result) {
        Ok(json) => Ok(cx.string(json)),
        Err(e) => cx.throw_error(e.to_string()),
    }
}
