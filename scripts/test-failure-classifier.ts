import assert from "node:assert/strict";

import {
  classifyFailureMessage,
  classifyRuntimeError,
  isTransientProviderError,
} from "../packages/workflows/src/failure-classifier";

function testBareTerminatedIsRetryableProviderFailure() {
  const error = new Error("terminated");
  assert.equal(isTransientProviderError(error), true);
  assert.equal(classifyRuntimeError(error), "transient_provider");

  const classification = classifyFailureMessage("terminated");
  assert.equal(classification.class, "transient_provider");
  assert.equal(classification.retryable, true);
}

function testDocumentedToolErrorsAreRetryableProviderFailures() {
  const containerExpired = new Error("code_execution_tool_result_error: container_expired");
  assert.equal(isTransientProviderError(containerExpired), true);
  assert.equal(classifyRuntimeError(containerExpired), "transient_provider");

  const executionExceeded = new Error("bash_code_execution_tool_result_error: execution_time_exceeded");
  assert.equal(isTransientProviderError(executionExceeded), true);
  assert.equal(classifyRuntimeError(executionExceeded), "transient_provider");

  const unavailable = new Error("text_editor_code_execution_tool_result_error: unavailable");
  assert.equal(isTransientProviderError(unavailable), true);
  assert.equal(classifyRuntimeError(unavailable), "transient_provider");
}

function testInvalidToolInputStaysNonRetryable() {
  const error = new Error("code_execution_tool_result_error: invalid_tool_input");
  assert.equal(isTransientProviderError(error), false);
  assert.equal(classifyRuntimeError(error), "internal_processing_error");
}

function main() {
  testBareTerminatedIsRetryableProviderFailure();
  testDocumentedToolErrorsAreRetryableProviderFailures();
  testInvalidToolInputStaysNonRetryable();
  console.log("test-failure-classifier: ok");
}

main();
