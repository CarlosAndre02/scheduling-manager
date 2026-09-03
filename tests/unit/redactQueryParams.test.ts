import { redactQueryParams } from "../../src/shared/core/redactQueryParams";

// The one unit test in the suite, and the exception is deliberate: this is a
// pure string transform, and reaching it over HTTP would mean taking the
// database down mid-run to provoke a driver error.
describe("redactQueryParams", () => {
  it("Should remove the values a failed query was called with", () => {
    const message =
      'Failed query: select "id" from "user" where "email" = $1\n' +
      "params: someone@example.com,1";

    expect(redactQueryParams(message)).not.toContain("someone@example.com");
    expect(redactQueryParams(message)).toContain("params: [redacted]");
  });

  // The SQL names columns, not values, and it is what makes the record useful.
  it("Should keep the query itself", () => {
    const message = 'Failed query: select "id" from "user"\nparams: secret';

    expect(redactQueryParams(message)).toContain('select "id" from "user"');
  });

  // A free-text field can contain newlines, so stopping at the end of the line
  // would leave the rest of the value in the log.
  it("Should cover a value that spans several lines", () => {
    const stack =
      "params: first line\nsecond secret line\n    at Repo.exists (/app/x.js:1:1)";

    const redacted = redactQueryParams(stack);

    expect(redacted).not.toContain("second secret line");
    expect(redacted).toContain("at Repo.exists");
  });

  // Losing the cause chain would trade a data leak for a blind incident.
  it("Should keep the cause chain that names the failure", () => {
    const stack =
      "params: someone@example.com,1\n" +
      "caused by: Error: connect ECONNREFUSED 127.0.0.1:5432";

    const redacted = redactQueryParams(stack);

    expect(redacted).not.toContain("someone@example.com");
    expect(redacted).toContain("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("Should walk a serialised error rather than only a plain string", () => {
    const serialized = {
      type: "Error",
      message: "Failed query: x\nparams: someone@example.com",
      stack: "Error: x\nparams: someone@example.com\n    at f (/app/a.js:1:1)",
    };

    const redacted = redactQueryParams(serialized);

    expect(JSON.stringify(redacted)).not.toContain("someone@example.com");
    expect(redacted.type).toBe("Error");
  });

  it("Should leave a record with no parameters untouched", () => {
    const record = { type: "TypeError", message: "x is not a function" };

    expect(redactQueryParams(record)).toEqual(record);
  });
});
