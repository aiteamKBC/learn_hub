import { BellRing, Download, GraduationCap, MoveRight, X } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/ui/input";
import { useNavigate } from "@/lib/router";

import {
  type Person,
  unitLabel,
  useMovePeople,
  useRemindPeople,
  useSelectedRows,
  useUnits,
} from "./api";

export type Picked = Pick<Person, "member_id" | "name" | "email" | "units">;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function PeopleList({ people }: { people: Picked[] }) {
  return (
    <ul className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-border p-2 text-sm">
      {people.map((p) => (
        <li key={p.member_id} className="flex min-w-0 items-center gap-2">
          <Avatar name={p.name || p.email} size="sm" />
          <span className="min-w-0 flex-1 truncate">{p.name || p.email}</span>
          <span className="shrink-0 truncate text-xs text-muted">
            {p.units[0] ?? "No unit"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Move people's primary location or team. Shows who moves from where to where before
 * anything changes. */
export function MoveDialog({
  people,
  open,
  onOpenChange,
  onDone,
}: {
  people: Picked[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const { data: units } = useUnits();
  const move = useMovePeople();
  const [unitId, setUnitId] = useState("");
  const dest = units?.find((u) => u.id === unitId);
  const confirm = () =>
    move.mutate(
      { member_ids: people.map((p) => p.member_id), unit_id: unitId },
      {
        onSuccess: (r) => {
          toast.success(
            r.moved
              ? `${plural(r.moved, "person", "people")} moved to ${dest?.name}`
              : "Nobody moved: they were already there",
          );
          if (r.moved && r.unchanged)
            toast.info(
              `${plural(r.unchanged, "person was", "people were")} already there`,
            );
          onOpenChange(false);
          setUnitId("");
          onDone?.();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Move ${plural(people.length, "person", "people")}`}
        description="This changes their main location or team. Other teams they belong to, their role and their training history stay as they are."
      >
        <div className="grid gap-4">
          <Field label="Move to">
            {(p) => (
              <NativeSelect
                {...p}
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
              >
                <option value="">Choose a location or team</option>
                {units?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {unitLabel(u, units)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <PeopleList people={people} />
          {dest ? (
            <p className="flex items-center gap-1.5 text-sm" aria-live="polite">
              <MoveRight className="size-4 text-primary" /> Their main unit
              becomes <span className="font-semibold">{dest.name}</span>.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={!unitId}
              loading={move.isPending}
              onClick={confirm}
            >
              Move {plural(people.length, "person", "people")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemindDialog({
  people,
  open,
  onOpenChange,
}: {
  people: Picked[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const remind = useRemindPeople();
  const [result, setResult] = useState<{
    sent: number;
    skipped: number;
    failed: number;
    people_without_due_training: number;
  } | null>(null);
  const close = (o: boolean) => (onOpenChange(o), o ? null : setResult(null));
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={`Remind ${plural(people.length, "person", "people")}?`}
        description="Each person gets one email for every required training that is still due. Nobody is reminded twice on the same day."
      >
        {result ? (
          <div className="grid gap-4" aria-live="polite">
            <ul className="grid gap-1 text-sm">
              <li>
                <span className="font-semibold tabular">{result.sent}</span>{" "}
                {result.sent === 1 ? "reminder" : "reminders"} sent
              </li>
              {result.skipped ? (
                <li className="text-muted">
                  {plural(result.skipped, "training")} skipped: already reminded
                  today
                </li>
              ) : null}
              {result.people_without_due_training ? (
                <li className="text-muted">
                  {plural(
                    result.people_without_due_training,
                    "person has",
                    "people have",
                  )}{" "}
                  nothing due
                </li>
              ) : null}
              {result.failed ? (
                <li className="text-danger">
                  {plural(result.failed, "reminder")} could not be sent
                </li>
              ) : null}
            </ul>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button variant="secondary">Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <PeopleList people={people} />
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button
                loading={remind.isPending}
                disabled={remind.isPending}
                onClick={() =>
                  remind.mutate(
                    people.map((p) => p.member_id),
                    {
                      onSuccess: setResult,
                      onError: (e) => toast.error((e as Error).message),
                    },
                  )
                }
              >
                <BellRing /> Send reminders
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A cell that is safe to open in a spreadsheet (no formulas). */
function cell(v: string | number) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function useExport() {
  const rows = useSelectedRows();
  return {
    pending: rows.isPending,
    run: (ids: string[]) =>
      rows.mutate(ids, {
        onSuccess: ({ items }) => {
          const head = [
            "Name",
            "Email",
            "Role",
            "Units",
            "Job roles",
            "Job title",
            "Employee ref",
            "Required",
            "Complete",
            "Overdue or expired",
            "Expiring soon",
          ];
          const body = items.map((p) => [
            p.name,
            p.email,
            p.role,
            p.units.join("; "),
            p.job_roles.join("; "),
            p.job_title,
            p.employee_ref,
            p.total,
            p.compliant,
            p.overdue,
            p.expiring,
          ]);
          const csv = [head, ...body]
            .map((r) => r.map(cell).join(","))
            .join("\r\n");
          const url = URL.createObjectURL(
            new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }),
          );
          const a = Object.assign(document.createElement("a"), {
            href: url,
            download: `people-${new Date().toISOString().slice(0, 10)}.csv`,
          });
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`${plural(items.length, "person", "people")} exported`);
        },
        onError: (e) => toast.error((e as Error).message),
      }),
  };
}

/** The bar that appears while people are selected. */
export function BulkBar({
  selected,
  admin,
  scopeNote,
  onClear,
}: {
  selected: Picked[];
  admin: boolean;
  scopeNote: string;
  onClear: () => void;
}) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"move" | "remind" | null>(null);
  const exp = useExport();
  const ids = selected.map((p) => p.member_id);
  return (
    <div
      role="region"
      aria-label="Actions for the selected people"
      className="animate-reveal flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/40 px-4 py-3"
    >
      <p className="mr-auto text-sm" aria-live="polite">
        <span className="font-semibold tabular">{selected.length}</span>{" "}
        selected <span className="text-xs text-muted">· {scopeNote}</span>
      </p>
      {admin ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate("/business/library?assign=new", {
              state: {
                people: selected.map((p) => ({
                  id: p.member_id,
                  name: p.name || p.email,
                })),
              },
            })
          }
        >
          <GraduationCap /> Assign training
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => setDialog("remind")}>
        <BellRing /> Send reminder
      </Button>
      {admin ? (
        <Button size="sm" variant="secondary" onClick={() => setDialog("move")}>
          <MoveRight /> Move to team
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        loading={exp.pending}
        onClick={() => exp.run(ids)}
      >
        <Download /> Export selected
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        <X /> Clear selection
      </Button>
      <MoveDialog
        people={selected}
        open={dialog === "move"}
        onOpenChange={(o) => setDialog(o ? "move" : null)}
        onDone={onClear}
      />
      <RemindDialog
        people={selected}
        open={dialog === "remind"}
        onOpenChange={(o) => setDialog(o ? "remind" : null)}
      />
    </div>
  );
}
