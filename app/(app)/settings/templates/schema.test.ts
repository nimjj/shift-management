import { describe, expect, it } from "vitest";
import { createTemplateSchema, templateFormToObject, updateTemplateSchema } from "./schema";

const valid = {
  code: " 2a ",
  name: "  Block 2a · Sat AM ",
  start_weekday: "6",
  start_time: "10:00",
  end_weekday: "6",
  end_time: "16:00",
  timezone: "",
  required_headcount: "2",
  colour: "#0ea5e9",
  active: true,
};

const issues = (input: unknown) => {
  const r = createTemplateSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("createTemplateSchema", () => {
  it("parses a valid block, trimming text and coercing numbers", () => {
    const r = createTemplateSchema.parse(valid);
    expect(r).toMatchObject({
      code: "2a",
      name: "Block 2a · Sat AM",
      start_weekday: 6,
      end_weekday: 6,
      required_headcount: 2,
      timezone: null,
    });
  });

  it("blank time zone means 'follow the organisation' (null); a real zone is kept", () => {
    expect(createTemplateSchema.parse(valid).timezone).toBeNull();
    expect(createTemplateSchema.parse({ ...valid, timezone: "Asia/Colombo" }).timezone).toBe("Asia/Colombo");
  });

  it("rejects an unknown time zone", () => {
    expect(issues({ ...valid, timezone: "Mars/Olympus" }).join()).toMatch(/Unknown time zone/);
  });

  it("enforces the code format", () => {
    for (const code of ["", "toolongcode", "a b", "a-b", "é"]) {
      expect(issues({ ...valid, code }).join(), code).toMatch(/code|1 to 8/);
    }
    expect(createTemplateSchema.safeParse({ ...valid, code: "A1b2C3d4" }).success).toBe(true);
  });

  it("enforces the weekday range", () => {
    expect(createTemplateSchema.safeParse({ ...valid, start_weekday: "7" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, end_weekday: "-1" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, start_weekday: "0", end_weekday: "0" }).success).toBe(true);
  });

  it("enforces HH:MM times", () => {
    expect(issues({ ...valid, start_time: "9:00" }).join()).toMatch(/HH:MM/);
    expect(issues({ ...valid, end_time: "24:00" }).join()).toMatch(/HH:MM/);
  });

  it("rejects a block that ends before or when it starts", () => {
    expect(issues({ ...valid, end_time: "10:00" }).join()).toMatch(/end_time: The end must be after the start/);
    expect(issues({ ...valid, end_time: "09:00" }).join()).toMatch(/after the start/);
  });

  it("allows a block that crosses midnight into the next weekday", () => {
    expect(
      createTemplateSchema.safeParse({ ...valid, start_weekday: "5", start_time: "22:00", end_weekday: "6", end_time: "03:00" })
        .success,
    ).toBe(true);
  });

  it("allows exactly 24 hours but not a minute more", () => {
    const day = { ...valid, start_weekday: "5", start_time: "10:00", end_weekday: "6" };
    expect(createTemplateSchema.safeParse({ ...day, end_time: "10:00" }).success).toBe(true);
    expect(issues({ ...day, end_time: "10:01" }).join()).toMatch(/24 hours/);
  });

  it("limits headcount to 1..10", () => {
    expect(createTemplateSchema.safeParse({ ...valid, required_headcount: "0" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, required_headcount: "11" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, required_headcount: "10" }).success).toBe(true);
    expect(createTemplateSchema.safeParse({ ...valid, required_headcount: "1.5" }).success).toBe(false);
  });

  it("requires a hex colour", () => {
    expect(createTemplateSchema.safeParse({ ...valid, colour: "blue" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, colour: "#fff" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...valid, colour: "#A855F7" }).success).toBe(true);
  });
});

describe("updateTemplateSchema", () => {
  it("also needs a uuid id and applies the same schedule rule", () => {
    expect(updateTemplateSchema.safeParse({ ...valid, id: "x" }).success).toBe(false);
    const id = "2f8d3a5e-6a7b-4c1d-9e0f-1a2b3c4d5e6f";
    expect(updateTemplateSchema.safeParse({ ...valid, id }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ ...valid, id, end_time: "09:00" }).success).toBe(false);
  });
});

describe("templateFormToObject", () => {
  it("maps the active checkbox and defaults", () => {
    const fd = new FormData();
    fd.set("active", "on");
    const o = templateFormToObject(fd);
    expect(o.active).toBe(true);
    expect(o.required_headcount).toBe("1");
    expect(templateFormToObject(new FormData()).active).toBe(false);
  });
});
