//! Tag an error with a machine-readable code before it crosses into JavaScript.
//!
//! The TypeScript side parses a leading `[CODE]` out of the message and maps it to
//! `ErrorCode`. That is what makes `NotFoundError`, `TimeoutError` and the other typed
//! error classes reachable; without the prefix every failure would arrive as
//! `ErrorCode.Unknown`.
//!
//! The code is sdk-core's, derived from the error's *variant*, never from its text:
//! sdk-core maps refused calls onto semantic variants, so a "no such workflow" reaches
//! here as `WorkflowNotFound` rather than an opaque status, and the tag is accurate
//! rather than guessed.

use orcher_sdk_core::error::Error as CoreError;

/// The `ErrorCode` member this error corresponds to, in the spelling the
/// TypeScript enum uses for its values: sdk-core's own code for the error.
pub fn code_for(error: &CoreError) -> &'static str {
    error.code().as_str()
}

/// Format an error for the JavaScript side: `[CODE] context: message`.
///
/// An error that names something the caller needs to act on carries it in the
/// tag as `key=value`, so the TypeScript side reads it rather than parsing the
/// message: `[WORKFLOW_ALREADY_EXISTS run_id=…]` names the run holding the id.
pub fn tagged(error: &CoreError, context: &str) -> String {
    let attributes = match error {
        CoreError::WorkflowAlreadyExists {
            run_id: Some(run_id),
            ..
        } if !run_id.is_empty() && !run_id.contains([' ', ']']) => format!(" run_id={run_id}"),
        _ => String::new(),
    };
    format!("[{}{}] {}: {}", code_for(error), attributes, context, error)
}

/// Tag a non-core error with an explicit code.
///
/// Transport setup and JSON conversion fail with their own error types, which carry no
/// Orcher semantics. The code is stated at the call site rather than inferred, so it stays
/// accurate instead of defaulting everything to UNKNOWN.
pub fn tagged_as(code: &str, error: impl std::fmt::Display, context: &str) -> String {
    format!("[{}] {}: {}", code, context, error)
}
