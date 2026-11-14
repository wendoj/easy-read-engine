/**
 * What the highlight colours mean, for the fact types in this letter only.
 * Each type has one colour and its own underline, the same in both columns.
 */
import type { KeyFact } from "@/src/checker-client/schemas";
import { FACT_TYPE_ORDER, factClassName } from "@/src/ui/key-fact-highlight";

const WORDS: Record<KeyFact["type"], string> = {
  date: "Dates",
  time: "Times",
  money: "Amounts",
  reference: "Reference numbers",
  phone: "Phone numbers",
  address: "Addresses",
  action: "Things to do",
};

export function FactLegend({ keyFacts }: { keyFacts: readonly KeyFact[] }) {
  const types = FACT_TYPE_ORDER.filter((t) => keyFacts.some((f) => f.type === t));
  if (types.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg font-semibold">Colours in both versions</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-lg">
        {types.map((type) => (
          <li key={type}>
            <span
              className={factClassName({
                factId: type,
                type,
                colour: FACT_TYPE_ORDER.indexOf(type),
                failed: false,
                label: "",
              })}
            >
              {WORDS[type]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
