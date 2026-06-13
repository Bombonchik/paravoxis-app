import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Loader2, Languages, Radio, Volume2, VolumeX } from "lucide-react";
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
  createStreamsClient,
  type AgentState,
  type ConnectContact,
} from "@/lib/connect/streams-client";
import { TranslationSession } from "@/lib/core/translation-session";
import { LiveTranslator } from "@/lib/core/live-translator";
import { DemoTranslator } from "@/lib/core/demo-translator";
import type { CallSession, Speaker, TranscriptSegment } from "@/lib/core/types";
import { loadAwsConfig } from "@/lib/aws/config";
import type { StreamsClient } from "@/lib/connect/streams-client";

async function waitForCustomerAudio(client: StreamsClient, timeoutMs: number): Promise<MediaStream | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stream = client.getCustomerAudioStream();
    if (stream && stream.getAudioTracks().length > 0) return stream;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_AGENT_LANGUAGE,
  DEFAULT_CALLER_LANGUAGE,
} from "@/lib/shared/constants";
import { toast } from "sonner";

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
  const clientRef = useRef(createStreamsClient());
  const sessionRef = useRef<TranslationSession | null>(null);
  const translatorRef = useRef<LiveTranslator | null>(null);
  const ccpContainerRef = useRef<HTMLDivElement | null>(null);
  const [agentState, setAgentState] = useState<AgentState>("offline");
  const [contact, setContact] = useState<ConnectContact | null>(null);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agentLang, setAgentLang] = useState<string>(DEFAULT_AGENT_LANGUAGE);
  const [callerLang, setCallerLang] = useState<string>(DEFAULT_CALLER_LANGUAGE);
  const [callState, setCallState] = useState<CallSession | null>(null);
  const [speakOut, setSpeakOut] = useState(true);
  const [demoActive, setDemoActive] = useState<Record<Speaker, boolean>>({ caller: false, agent: false });
  const [demoStarting, setDemoStarting] = useState(false);
  const demoRef = useRef<DemoTranslator | null>(null);
  const isMock = !loadAwsConfig()?.connectInstanceUrl;
  const hasAws = !!loadAwsConfig()?.accessKeyId;

  function startTranslation(contactId: string) {
    if (translatorRef.current) translatorRef.current.dispose();
    sessionRef.current = new TranslationSession({
      contactId,
      callerLanguage: callerLang,
      agentLanguage: agentLang,
    });
    sessionRef.current.subscribe(setCallState);

    void (async () => {
      try {
        console.info("[workspace] contact connected, waiting for customer audio stream…");
        const customerAudio = await waitForCustomerAudio(clientRef.current, 8000);
        if (!customerAudio) {
          console.error("[workspace] customer audio stream never appeared");
          toast.error("Customer audio stream never appeared — check DevTools console.");
          return;
        }
        console.info("[workspace] got customer audio stream", {
          tracks: customerAudio.getAudioTracks().map((t) => ({ id: t.id, label: t.label, enabled: t.enabled, muted: t.muted })),
        });
        const agentMic = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.info("[workspace] got agent mic", { tracks: agentMic.getAudioTracks().length });
        const translator = new LiveTranslator({
          session: sessionRef.current!,
          customerAudio,
          agentAudio: agentMic,
          callerLanguage: callerLang,
          agentLanguage: agentLang,
          speakTranslations: speakOut,
          agentSender: clientRef.current.getAgentRtpSender(),
          onError: (e) => toast.error(`Translation pipeline error: ${(e as Error).message}`),
        });
        translatorRef.current = translator;
        console.info("[workspace] starting LiveTranslator…");
        await translator.start();
        console.info("[workspace] LiveTranslator started successfully");
      } catch (e) {
        console.error("[workspace] live translation failed to start:", e);
        toast.error(`Translation failed: ${(e as Error).message ?? String(e)}`);
      }
    })();
  }

  function stopTranslation() {
    translatorRef.current?.dispose();
    translatorRef.current = null;
    sessionRef.current = null;
    setCallState(null);
  }

  useEffect(() => {
    const off1 = clientRef.current.onAgentStateChange(setAgentState);
    const off2 = clientRef.current.onContact((c) => {
      setContact(c);
      if (c.state === "connected" && !sessionRef.current) {
        startTranslation(c.contactId);
      }
      if (c.state === "ended") {
        stopTranslation();
      }
    });
    return () => {
      off1();
      off2();
      translatorRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    if (!ccpContainerRef.current) return;
    setConnecting(true);
    try {
      await clientRef.current.connect(ccpContainerRef.current);
    } catch (e) {
      toast.error(`Failed to connect to CCP: ${(e as Error).message}`);
    } finally {
      setConnecting(false);
    }
  }

  async function goAvailable() {
    await clientRef.current.setAgentState("available");
  }

  async function hangup() {
    if (contact) {
      await clientRef.current.hangup(contact.contactId);
      setContact({ ...contact, state: "ended" });
      stopTranslation();
    }
  }

  async function accept() {
    if (!contact) return;
    await clientRef.current.acceptContact(contact.contactId);
  }

  async function toggleMute() {
    const next = await clientRef.current.toggleMute();
    setMuted(next);
  }

  async function toggleHold() {
    const next = await clientRef.current.toggleHold();
    setOnHold(next);
  }

  async function ensureDemoStarted(): Promise<DemoTranslator | null> {
    if (demoRef.current) return demoRef.current;
    setDemoStarting(true);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const session = new TranslationSession({
        contactId: `demo-${Date.now()}`,
        callerLanguage: callerLang,
        agentLanguage: agentLang,
      });
      session.subscribe(setCallState);
      sessionRef.current = session;
      setContact({
        contactId: session.snapshot.contactId,
        callerNumber: "Demo session",
        attributes: {},
        state: "connected",
      });
      const translator = new DemoTranslator({
        session,
        mic,
        languages: { caller: callerLang, agent: agentLang },
        speakTranslations: speakOut,
        onError: (e) => toast.error(`Translation error: ${(e as Error).message}`),
      });
      demoRef.current = translator;
      return translator;
    } catch (e) {
      toast.error(`Could not start demo: ${(e as Error).message}`);
      return null;
    } finally {
      setDemoStarting(false);
    }
  }

  async function toggleDemoSpeaker(speaker: Speaker) {
    const translator = await ensureDemoStarted();
    if (!translator) return;
    if (translator.isActive(speaker)) {
      await translator.stopSpeaking(speaker);
      setDemoActive((prev) => ({ ...prev, [speaker]: false }));
    } else {
      try {
        await translator.startSpeaking(speaker);
        setDemoActive((prev) => ({ ...prev, [speaker]: true }));
      } catch {
        /* error already toasted */
      }
    }
  }

  async function endDemo() {
    if (!demoRef.current) return;
    await demoRef.current.dispose();
    demoRef.current = null;
    setDemoActive({ caller: false, agent: false });
    sessionRef.current = null;
    setCallState(null);
    setContact(null);
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
            isMock={isMock}
            onAccept={accept}
            onHangup={hangup}
            onToggleMute={toggleMute}
            onToggleHold={toggleHold}
          />
          <LanguagePanel
            callerLang={callerLang}
            agentLang={agentLang}
            speakOut={speakOut}
            onCallerChange={setCallerLang}
            onAgentChange={setAgentLang}
            onSpeakOutChange={setSpeakOut}
          />
          {isMock ? (
            <DemoPanel
              hasAws={hasAws}
              starting={demoStarting}
              active={demoActive}
              callerLang={callerLang}
              agentLang={agentLang}
              hasSession={!!sessionRef.current}
              onToggle={toggleDemoSpeaker}
              onEnd={endDemo}
            />
          ) : null}
          <div
            ref={ccpContainerRef}
            id="ccp-container"
            className="h-[460px] w-full overflow-hidden rounded-md border bg-card"
            style={{ display: isMock ? "none" : "block" }}
          />
          {/* Hidden <audio> element that plays the customer voice. With
              allowFramedSoftphone:false, the CCP iframe no longer plays the
              remote audio — it's our job. The RTC capture in streams-client.ts
              binds this element's srcObject when the peer connection's
              ontrack fires. */}
          <audio id="paravoxis-remote-audio" autoPlay playsInline className="hidden" />
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
  isMock,
  onAccept,
  onHangup,
  onToggleMute,
  onToggleHold,
}: {
  contact: ConnectContact | null;
  muted: boolean;
  onHold: boolean;
  isMock: boolean;
  onAccept: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
}) {
  const ringing = contact && contact.state === "connecting";
  const live = contact && contact.state === "connected";
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Active contact</div>
      {ringing ? (
        <>
          <div>
            <div className="font-medium animate-pulse">{contact.callerNumber ?? "Incoming call"}</div>
            <div className="text-xs text-muted-foreground">Ringing… ID {contact.contactId.slice(0, 12)}…</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onAccept}>
              <Phone className="mr-2 h-4 w-4" /> Answer
            </Button>
            <Button variant="destructive" size="sm" onClick={onHangup}>
              <PhoneOff className="mr-2 h-4 w-4" /> Reject
            </Button>
          </div>
        </>
      ) : live ? (
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
        <p className="text-sm text-muted-foreground">
          {isMock
            ? "No Connect contact. Use the Demo translator panel below to try the pipeline."
            : "Waiting for a contact from Amazon Connect…"}
        </p>
      )}
    </Card>
  );
}

function DemoPanel({
  hasAws,
  starting,
  active,
  callerLang,
  agentLang,
  hasSession,
  onToggle,
  onEnd,
}: {
  hasAws: boolean;
  starting: boolean;
  active: Record<Speaker, boolean>;
  callerLang: string;
  agentLang: string;
  hasSession: boolean;
  onToggle: (speaker: Speaker) => void;
  onEnd: () => void;
}) {
  const callerLabel = SUPPORTED_LANGUAGES.find((l) => l.code === callerLang)?.label ?? callerLang;
  const agentLabel = SUPPORTED_LANGUAGES.find((l) => l.code === agentLang)?.label ?? agentLang;
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Demo translator</div>
      {!hasAws ? (
        <p className="text-sm text-muted-foreground">
          Add AWS credentials in <span className="font-medium">Settings → AWS</span> to enable the live
          translation demo.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            One mic, two roles. Click a button, speak the role's language, click again to stop. Each
            utterance is transcribed, translated, and (if enabled) spoken back via ElevenLabs.
          </p>
          <Button
            variant={active.caller ? "secondary" : "outline"}
            size="sm"
            className="w-full justify-start"
            onClick={() => onToggle("caller")}
            disabled={starting}
          >
            {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            {active.caller ? `Listening as caller (${callerLabel})…` : `Talk as caller (${callerLabel})`}
          </Button>
          <Button
            variant={active.agent ? "secondary" : "outline"}
            size="sm"
            className="w-full justify-start"
            onClick={() => onToggle("agent")}
            disabled={starting}
          >
            {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            {active.agent ? `Listening as agent (${agentLabel})…` : `Talk as agent (${agentLabel})`}
          </Button>
          {hasSession ? (
            <Button variant="destructive" size="sm" className="w-full" onClick={onEnd}>
              <PhoneOff className="mr-2 h-4 w-4" /> End demo
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

function LanguagePanel({
  callerLang,
  agentLang,
  speakOut,
  onCallerChange,
  onAgentChange,
  onSpeakOutChange,
}: {
  callerLang: string;
  agentLang: string;
  speakOut: boolean;
  onCallerChange: (v: string) => void;
  onAgentChange: (v: string) => void;
  onSpeakOutChange: (v: boolean) => void;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Languages className="h-3 w-3" /> Languages
      </div>
      <LanguageSelect label="Caller speaks" value={callerLang} onChange={onCallerChange} />
      <LanguageSelect label="Agent speaks" value={agentLang} onChange={onAgentChange} />
      <Button
        size="sm"
        variant={speakOut ? "secondary" : "outline"}
        className="w-full"
        onClick={() => onSpeakOutChange(!speakOut)}
      >
        {speakOut ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
        {speakOut ? "Speaking translations (ElevenLabs)" : "Translation speech off"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Each side is transcribed by AWS Transcribe Streaming, translated with Amazon Translate, and
        — when enabled — spoken back via ElevenLabs.
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
