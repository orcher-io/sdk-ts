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

use orcher_sdk_core::kernel::encoded;

/// `kernelResolve(pollResponse: Buffer, namespace: string): Buffer`
///
/// A recorded activation (an encoded `orcher.v1.PollWorkflowExecutionResponse`)
/// resolved by the kernel, as an encoded `orcher.kernel.v1.RunActivation`.
pub fn kernel_resolve(mut cx: FunctionContext) -> JsResult<JsBuffer> {
    let bytes = cx.argument::<JsBuffer>(0)?.as_slice(&cx).to_vec();
    let namespace = cx.argument::<JsString>(1)?.value(&mut cx);
    match encoded::resolve_recorded(&bytes, &namespace) {
        Ok(activation) => JsBuffer::from_slice(&mut cx, &activation),
        Err(e) => cx.throw_error(e.to_string()),
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
    let result = match encoded::execution_result(&run_id, &bytes) {
        Ok(result) => result,
        Err(e) => return cx.throw_error(e.to_string()),
    };
    match serde_json::to_string(&result) {
        Ok(json) => Ok(cx.string(json)),
        Err(e) => cx.throw_error(e.to_string()),
    }
}
