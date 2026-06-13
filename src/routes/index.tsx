import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Headphones, Languages, Mic, ShieldCheck, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "LinguaConnect — Real-time translated call centre workspace" },
      {
        name: "description",
        content:
          "Live speech-to-speech translation for call centre agents — auto-detect the caller's language and reply naturally in your own.",
      },
      { property: "og:title", content: "LinguaConnect" },
      {
        property: "og:description",
        content: "Real-time translated call centre workspace.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/workspace", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Headphones className="h-6 w-6 text-primary" />
          <span className="font-semibold tracking-tight">LinguaConnect</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/auth">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
          <Zap className="h-3 w-3 text-primary" />
          Real-time translated call centre
        </div>
        <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Speak any language.
          <br />
          <span className="text-primary">Answer every call.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
          LinguaConnect translates live calls in real time. The caller speaks Czech, your
          agent hears Hindi, and the agent's reply is spoken back in Czech — automatically.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Open the workspace</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#how">How it works</a>
          </Button>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-5xl px-6 py-12 grid gap-4 sm:grid-cols-3">
        <Feature
          icon={<Mic className="h-5 w-5" />}
          title="Auto language detection"
          body="The caller's language is identified live — no IVR prompts, no menus."
        />
        <Feature
          icon={<Languages className="h-5 w-5" />}
          title="Bidirectional translation"
          body="Caller speech → agent's language, agent speech → caller's language, sub-second."
        />
        <Feature
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Secure by design"
          body="Calls stay inside your own tenancy. Your conversation data is never shared."
        />
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-xs text-muted-foreground">
        LinguaConnect — built for modern multilingual contact centres.
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
