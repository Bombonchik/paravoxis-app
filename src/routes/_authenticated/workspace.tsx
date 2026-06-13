import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Loader2, Languages, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AppShell } from "@/features/agent-workspace/app-shell";
import {
  createMockStreamsClient,
  type AgentState,
  type ConnectContact,
} from "@/lib/connect/streams-client";
import { TranslationSession } from "@/lib/core/translation-session";
import type { CallSession, TranscriptSegment } from "@/lib/core/types";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_AGENT_LANGUAGE,
  DEFAULT_CALLER_LANGUAGE,
} from "@/lib/shared/constants";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace — LinguaConnect" },
      { name: "description", content: "Live translated Amazon Connect agent workspace." },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const clientRef = useRef(createMockStreamsClient());
  const sessionRef = useRef<TranslationSession | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("offline");
  const [contact, setContact] = useState<ConnectContact | null>(null);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agentLang, setAgentLang] = useState<string>(DEFAULT_AGENT_LANGUAGE);
  const [callerLang, setCallerLang] = useState<string>(DEFAULT_CALLER_LANGUAGE);
  const [callState, setCallState] = useState<CallSession | null>(null);

  useEffect(() => {
    const off1 = clientRef.current.onAgentStateChange(setAgentState);
    const off2 = clientRef.current.onContact((c) => {
      setContact(c);
      if (c.state === "connected" && !sessionRef.current) {
        sessionRef.current = new TranslationSession({
          contactId: c.contactId,
          callerLanguage: callerLang,
          agentLanguage: agentLang,
        });
        sessionRef.current.subscribe(setCallState);
      }
      if (c.state === "ended") {
        sessionRef.current = null;
        setCallState(null);
      }
    });
    return () => {
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setConnecting(true);
    await clientRef.current.connect("https://example.my.connect.aws", document.body);
    setConnecting(false);
  }

  async function goAvailable() {
    await clientRef.current.setAgentState("available");
  }

  async function simulateIncoming() {
    // Phase-1 mock so the UI is interactive before AWS is wired up.
    const fake: ConnectContact = {
      contactId: `mock-${Date.now()}`,
      callerNumber: "+420 720 555 014",
      attributes: { caller_language: callerLang },
      state: "connected",
    };
    setContact(fake);
    await clientRef.current.acceptContact(fake.contactId);
    sessionRef.current = new TranslationSession({
      contactId: fake.contactId,
      callerLanguage: callerLang,
      agentLanguage: agentLang,
    });
    sessionRef.current.subscribe(setCallState);
  }

  async function hangup() {
    if (contact) {
      await clientRef.current.hangup(contact.contactId);
      setContact({ ...contact, state: "ended" });
      sessionRef.current = null;
      setCallState(null);
    }
  }

  function addDemoSegment(speaker: "caller" | "agent") {
    if (!sessionRef.current) return;
    const seg: TranscriptSegment = {
      id: `${speaker}-${Date.now()}`,
      speaker,
      language: speaker === "caller" ? callerLang : agentLang,
      originalText:
        speaker === "caller"
          ? "Dobrý den, mám problém s objednávkou číslo 12345."
          : "नमस्ते, मैं आपकी मदद करने में खुश हूँ। क्या आप ऑर्डर नंबर दोहरा सकते हैं?",
      translatedText:
        speaker === "caller"
          ? "नमस्ते, मुझे ऑर्डर नंबर 12345 के साथ समस्या है।"
          : "Dobrý den, rád vám pomohu. Můžete zopakovat číslo objednávky?",
      translatedLanguage: speaker === "caller" ? agentLang : callerLang,
      isFinal: true,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    sessionRef.current.upsertSegment(seg);
  }

  return (
    <AppShell>
      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <AgentCard
            state={agentState}
            connecting={connecting}
            onConnect={connect}
            onAvailable={goAvailable}
          />
          <CallControls
            contact={contact}
            muted={muted}
            onHold={onHold}
            onSimulate={simulateIncoming}
            onHangup={hangup}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleHold={() => setOnHold((h) => !h)}
          />
          <LanguagePanel
            callerLang={callerLang}
            agentLang={agentLang}
            onCallerChange={setCallerLang}
            onAgentChange={setAgentLang}
          />
        </aside>

        <section className="min-h-[70vh]">
          <Transcript
            callState={callState}
            callerLang={callerLang}
            agentLang={agentLang}
            onDemo={addDemoSegment}
          />
        </section>
      </div>
    </AppShell>
  );
}

function AgentCard({
  state,
  connecting,
  onConnect,
  onAvailable,
}: {
  state: AgentState;
  connecting: boolean;
  onConnect: () => void;
  onAvailable: () => void;
}) {
  const color: Record<AgentState, string> = {
    offline: "bg-muted text-muted-foreground",
    available: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    "on-call": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    "after-call": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Agent state</div>
          <Badge variant="secondary" className={"mt-1 capitalize " + color[state]}>
            <Radio className="mr-1 h-3 w-3" />
            {state.replace("-", " ")}
          </Badge>
        </div>
        {state === "offline" ? (
          <Button size="sm" onClick={onConnect} disabled={connecting}>
            {connecting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Connect
          </Button>
        ) : state !== "available" && state !== "on-call" ? (
          <Button size="sm" variant="outline" onClick={onAvailable}>
            Go available
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Amazon Connect runs in headless mode. This shell uses a mock CCP until AWS credentials are
        configured in Settings.
      </p>
    </Card>
  );
}

function CallControls({
  contact,
  muted,
  onHold,
  onSimulate,
  onHangup,
  onToggleMute,
  onToggleHold,
}: {
  contact: ConnectContact | null;
  muted: boolean;
  onHold: boolean;
  onSimulate: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
}) {
  const live = contact && contact.state === "connected";
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Active contact</div>
      {live ? (
        <>
          <div>
            <div className="font-medium">{contact.callerNumber ?? "Unknown caller"}</div>
            <div className="text-xs text-muted-foreground">ID {contact.contactId.slice(0, 12)}…</div>
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-2">
            <Button variant={muted ? "secondary" : "outline"} size="sm" onClick={onToggleMute}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button variant={onHold ? "secondary" : "outline"} size="sm" onClick={onToggleHold}>
              {onHold ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button variant="destructive" size="sm" onClick={onHangup}>
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">No active call.</p>
          <Button size="sm" className="w-full" onClick={onSimulate}>
            <Phone className="mr-2 h-4 w-4" /> Simulate incoming call
          </Button>
        </>
      )}
    </Card>
  );
}

function LanguagePanel({
  callerLang,
  agentLang,
  onCallerChange,
  onAgentChange,
}: {
  callerLang: string;
  agentLang: string;
  onCallerChange: (v: string) => void;
  onAgentChange: (v: string) => void;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Languages className="h-3 w-3" /> Languages
      </div>
      <LanguageSelect label="Caller speaks" value={callerLang} onChange={onCallerChange} />
      <LanguageSelect label="Agent speaks" value={agentLang} onChange={onAgentChange} />
      <p className="text-xs text-muted-foreground">
        Caller language is auto-detected from the live stream once AWS Transcribe is wired up; you
        can override it here.
      </p>
    </Card>
  );
}

function LanguageSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Transcript({
  callState,
  callerLang,
  agentLang,
  onDemo,
}: {
  callState: CallSession | null;
  callerLang: string;
  agentLang: string;
  onDemo: (speaker: "caller" | "agent") => void;
}) {
  const callerLabel = useMemo(
    () => SUPPORTED_LANGUAGES.find((l) => l.code === callerLang)?.label ?? callerLang,
    [callerLang],
  );
  const agentLabel = useMemo(
    () => SUPPORTED_LANGUAGES.find((l) => l.code === agentLang)?.label ?? agentLang,
    [agentLang],
  );

  return (
    <Card className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <div className="text-sm font-semibold">Live translation</div>
          <div className="text-xs text-muted-foreground">
            Caller {callerLabel} ↔ Agent {agentLabel}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onDemo("caller")} disabled={!callState}>
            Demo caller turn
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDemo("agent")} disabled={!callState}>
            Demo agent turn
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {!callState ? (
          <EmptyTranscript />
        ) : callState.segments.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Waiting for first utterance…
          </div>
        ) : (
          <ul className="space-y-4">
            {callState.segments.map((s) => (
              <SegmentRow key={s.id} segment={s} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </Card>
  );
}

function SegmentRow({ segment }: { segment: TranscriptSegment }) {
  const isCaller = segment.speaker === "caller";
  return (
    <li className={"flex " + (isCaller ? "justify-start" : "justify-end")}>
      <div
        className={
          "max-w-[80%] rounded-lg border p-3 space-y-1 " +
          (isCaller ? "bg-muted/50" : "bg-primary/5 border-primary/20")
        }
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">{segment.speaker}</span>
          <span>·</span>
          <span>{segment.language}</span>
          {!segment.isFinal && <Badge variant="outline" className="ml-1">partial</Badge>}
        </div>
        <p className="text-sm">{segment.originalText}</p>
        {segment.translatedText && (
          <>
            <Separator className="my-1" />
            <p className="text-sm text-foreground/90">
              <span className="text-xs text-muted-foreground mr-1">→ {segment.translatedLanguage}:</span>
              {segment.translatedText}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

function EmptyTranscript() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2">
      <Languages className="h-8 w-8 text-muted-foreground/50" />
      <p>No active contact. Simulate an incoming call to see the live translation view.</p>
    </div>
  );
}
