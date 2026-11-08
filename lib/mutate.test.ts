import { describe, expect, it, vi } from "vitest";
import { ActionError } from "./db-errors";
import { callMutation, type RpcFn } from "./mutate";

const args = {
  p_full_name: "Pooja",
  p_email: "pooja@adept-tech.us",
  p_role: "agent" as const,
  p_active: true,
};

describe("callMutation", () => {
  it("calls the named function with its args and returns the unwrapped data", async () => {
    const row = { id: "e1", full_name: "Pooja" };
    const rpc = vi.fn<RpcFn>().mockResolvedValue({ data: { audit_id: 7, data: row }, error: null });

    await expect(callMutation(rpc, "create_employee", args)).resolves.toEqual(row);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_employee", args);
  });

  it("turns a validation error (P0001) into an ActionError with the original message", async () => {
    const rpc: RpcFn = async () => ({
      data: null,
      error: { code: "P0001", message: "Email must be on an allowed domain: adept-tech.us" },
    });

    const err = await callMutation(rpc, "create_employee", args).catch((e) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect(err.message).toBe("Email must be on an allowed domain: adept-tech.us");
  });

  it("turns a duplicate email into a friendly ActionError", async () => {
    const rpc: RpcFn = async () => ({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "employees_email_key"' },
    });

    const err = await callMutation(rpc, "create_employee", args).catch((e) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect(err.message).toBe("An employee with that email already exists.");
  });

  it("rethrows unexpected database errors as plain Errors (not shown to users)", async () => {
    const rpc: RpcFn = async () => ({ data: null, error: { code: "XX000", message: "boom" } });

    const err = await callMutation(rpc, "create_employee", args).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ActionError);
    expect(err.message).toBe("boom");
  });

  it("refuses a result without an audit_id (mutation functions must call write_audit)", async () => {
    for (const data of [null, {}, { data: { id: "e1" } }, { audit_id: "7", data: {} }]) {
      const rpc: RpcFn = async () => ({ data, error: null });
      await expect(callMutation(rpc, "update_employee", { ...args, p_id: "e1" })).rejects.toThrow(/audit_id/);
    }
  });
});
