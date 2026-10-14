//! The kernel protocol (`orcher.kernel.v1`) for checking recorded activations
//! without an engine, as the worker host runs them on a live worker:
//!
//! - `kernelResolve`: a recorded activation, resolved by the kernel into the
//!   `RunActivation` the host hands TypeScript.
//! - `kernelExecutionResult`: TypeScript's `RunActivationResult`, as the
//!   result the workflow driver checks and sends.
//!
//! `contract/replay-check.ts` uses them to replay a recorded corpus against
//! committed expected results. Messages cross as their protobuf encoding;
//! results as JSON.

use neon::prelude::*;
use neon::types::buffer::TypedArray;

use orcher_sdk_core::proto::kernel::v1::RunActivationResult;
use orcher_sdk_core::proto::orcher::v1::PollWorkflowExecutionResponse;
use orcher_sdk_core::proto::prost::Message;
use orcher_sdk_core::WorkflowExecutionTask;

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
