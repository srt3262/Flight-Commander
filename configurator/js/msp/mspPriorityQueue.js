"use strict";

export function insertMspRequestByPriority(queue, request) {
  if (!Array.isArray(queue)) {
    throw new TypeError("The MSP request queue must be an array.");
  }
  if (request?.priority !== true) {
    queue.push(request);
    return queue.length - 1;
  }

  const firstNormalRequest = queue.findIndex(
    (queuedRequest) => queuedRequest?.priority !== true,
  );
  if (firstNormalRequest === -1) {
    queue.push(request);
    return queue.length - 1;
  }
  queue.splice(firstNormalRequest, 0, request);
  return firstNormalRequest;
}

export default insertMspRequestByPriority;
