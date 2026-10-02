export const PROVIDER_TRANSPORT_FAILURE_MESSAGE =
  "Could not reach the model provider. Check that its server is running and reachable, then retry.";

// A provider call can fail before any HTTP status exists: the runtime (Bun on
// the OpenChamber side) reports a refused TCP connect, a reset socket, or a DNS
// failure as a raw fetch error. Those strings are meaningful to an operator but
// not to a user, so they are recognised here and replaced with an actionable
// message. Keep the markers lowercase; the input is lowercased before matching.
const TRANSPORT_FAILURE_MARKERS = [
  "connectionrefused",
  "econnrefused",
  "econnreset",
  "ehostunreach",
  "enetunreach",
  "unable to connect",
  "socket connection was closed unexpectedly",
  "socket hang up",
  "fetch failed",
  "getaddrinfo",
  "enotfound",
  "connection timed out",
  "connect timeout",
];

// `detail` is the assistant error text the caller has already narrowed to a
// string; `undefined` covers a message that carried no readable detail.
export const isLikelyProviderTransportFailure = (detail: string | undefined): boolean => {
  if (!detail) {
    return false;
  }

  const normalized = detail.toLowerCase();
  return TRANSPORT_FAILURE_MARKERS.some((marker) => normalized.includes(marker));
};
