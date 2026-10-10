"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, cx } from "@/components/ui";
import { firstName, fmtTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Message, Person } from "./pool-view";

export default function PoolChat({
  poolId,
  me,
  people,
  initial,
}: {
  poolId: string;
  me: string;
  people: Person[];
  initial: Message[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ch = supabase
      .channel(`pool-chat:${poolId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `pool_id=eq.${poolId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, poolId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    const { data, error } = await supabase
      .from("messages")
      .insert({ pool_id: poolId, user_id: me, body })
      .select("id, user_id, body, created_at")
      .single<Message>();
    if (error) setText(body);
    else setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]));
  }

  const nameOf = (id: string) => firstName(people.find((p) => p.id === id)?.full_name);

  return (
    <Card className="grid gap-3">
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Group chat</h2>
      <div className="grid max-h-80 gap-2 overflow-y-auto">
        {messages.length === 0 && <p className="text-sm text-muted">Say hi and agree on a meeting point at arrivals.</p>}
        {messages.map((m) => {
          const mine = m.user_id === me;
          return (
            <div key={m.id} className={cx("max-w-[80%] rounded-2xl px-3 py-2 text-sm", mine ? "ml-auto bg-accent/15" : "bg-surface-2")}>
              {!mine && <p className="text-xs font-medium text-accent">{nameOf(m.user_id)}</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-0.5 text-right text-[10px] text-muted">{fmtTime(m.created_at)}</p>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="grid grid-cols-[1fr_auto] gap-2">
        <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Message the group" />
        <Button type="submit" disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </Card>
  );
}
