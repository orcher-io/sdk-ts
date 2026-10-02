//! Tag an error with a machine-readable code before it crosses into JavaScript.
//!
//! The TypeScript side parses a leading `[CODE]` out of the message and maps it to
//! `ErrorCode`. That is what makes `NotFoundError`, `TimeoutError` and the other typed
//! error classes reachable; without the prefix every failure would arrive as
//! `ErrorCode.Unknown`.
//!
//! The code is derived from the error's *variant*, never from its text. sdk-core maps
//! gRPC statuses onto semantic variants, so a "no such workflow" reaches here as
//! `WorkflowNotFound` rather than an opaque status, and the tag is accurate rather than
//! guessed.

use orcher_sdk_core::error::Error as CoreError;

/// The `ErrorCode` member this error corresponds to, in the spelling the
/// TypeScript enum uses for its values.
pub fn code_for(error: &CoreError) -> &'static str {
    match error {
        // Workflow-scoped variants report the orchestration code, matching the
        // Rust and Python SDKs. A bare gRPC NotFound (below) is not attributable
        // to a workflow, so it keeps the transport spelling.
        CoreError::WorkflowNotFound { .. } => "WORKFLOW_NOT_FOUND",
        CoreError::WorkflowAlreadyExists { .. } => "WORKFLOW_ALREADY_EXISTS",
        CoreError::Timeout { .. } => "TIMEOUT",
        CoreError::Transport(_) | CoreError::Connection(_) => "CONNECTION_FAILED",
        CoreError::Authentication(_) => "UNAUTHENTICATED",
        CoreError::Authorization(_) => "PERMISSION_DENIED",
        CoreError::Configuration(_) | CoreError::InvalidPayload { .. } => "INVALID_ARGUMENT",
        CoreError::Serialization(_) | CoreError::Deserialization(_) | CoreError::Codec(_) => {
            "INTERNAL"
        }
        CoreError::GrpcStatus(status) => match status.code() {
            tonic::Code::NotFound => "NOT_FOUND",
            tonic::Code::AlreadyExists => "ALREADY_EXISTS",
            tonic::Code::DeadlineExceeded => "TIMEOUT",
            tonic::Code::Unavailable => "UNAVAILABLE",
            tonic::Code::PermissionDenied => "PERMISSION_DENIED",
            tonic::Code::Unauthenticated => "UNAUTHENTICATED",
            tonic::Code::InvalidArgument => "INVALID_ARGUMENT",
            tonic::Code::ResourceExhausted => "RESOURCE_EXHAUSTED",
            tonic::Code::FailedPrecondition => "FAILED_PRECONDITION",
            tonic::Code::Aborted => "ABORTED",
            tonic::Code::OutOfRange => "OUT_OF_RANGE",
            tonic::Code::Unimplemented => "UNIMPLEMENTED",
            tonic::Code::DataLoss => "DATA_LOSS",
            _ => "INTERNAL",
        },
        // Anything without a distinct meaning stays UNKNOWN rather than being
        // filed under a code that would mislead a caller matching on it.
        _ => "UNKNOWN",
    }
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
