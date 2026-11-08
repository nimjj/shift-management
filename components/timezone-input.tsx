import { Input } from "@/components/ui/input";

// All IANA zone names the runtime knows; used only to power the browser's autocomplete.
const ZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/** A text box with time-zone autocomplete. Free typing is still allowed; the server validates. */
export function TimeZoneInput(props: React.ComponentProps<typeof Input> & { listId: string }) {
  const { listId, ...rest } = props;
  return (
    <>
      <Input list={listId} autoComplete="off" spellCheck={false} {...rest} />
      <datalist id={listId}>
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
