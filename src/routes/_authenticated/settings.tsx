import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/features/agent-workspace/app-shell";
import { SUPPORTED_LANGUAGES } from "@/lib/shared/constants";
import { loadAwsConfig, saveAwsConfig, type AwsRuntimeConfig } from "@/lib/aws/config";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LinguaConnect" },
      { name: "description", content: "Configure your agent profile and language defaults." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [agentLanguage, setAgentLanguage] = useState("hi-IN");
  const [connectUsername, setConnectUsername] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [aws, setAws] = useState<AwsRuntimeConfig>({
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    connectInstanceUrl: "",
  });

  useEffect(() => {
    (async () => {
      const stored = loadAwsConfig();
      if (stored) setAws({ sessionToken: "", ...stored });
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setLoading(false);
        return;
      }
      const [{ data: profile }, { data: rolesData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userData.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userData.user.id),
      ]);
      if (profile) {
        setDisplayName(profile.display_name ?? "");
        setAgentLanguage(profile.agent_language ?? "hi-IN");
        setConnectUsername(profile.connect_username ?? "");
      }
      setRoles((rolesData ?? []).map((r) => r.role));
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    saveAwsConfig({
      region: aws.region.trim(),
      accessKeyId: aws.accessKeyId.trim(),
      secretAccessKey: aws.secretAccessKey.trim(),
      sessionToken: aws.sessionToken?.trim() || undefined,
      connectInstanceUrl: aws.connectInstanceUrl.trim().replace(/\/$/, ""),
    });
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      toast.success("AWS settings saved locally");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        agent_language: agentLanguage,
        connect_username: connectUsername || null,
      })
      .eq("id", userData.user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Profile, default language, and Amazon Connect mapping.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>How you appear to teammates and on transcripts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Roles</Label>
                  <div className="flex gap-2">
                    {roles.length === 0 ? (
                      <Badge variant="outline">none</Badge>
                    ) : (
                      roles.map((r) => (
                        <Badge key={r} variant="secondary" className="capitalize">
                          {r}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Language</CardTitle>
                <CardDescription>
                  Your default language. Calls translate caller speech into this language and your speech
                  into the caller's language.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Agent language</Label>
                  <Select value={agentLanguage} onValueChange={setAgentLanguage}>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Amazon Connect</CardTitle>
                <CardDescription>
                  Map this account to a Connect agent username and point the CCP at your instance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="connect-username">Connect username</Label>
                  <Input
                    id="connect-username"
                    placeholder="agent.jane"
                    value={connectUsername}
                    onChange={(e) => setConnectUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connect-url">Connect instance URL</Label>
                  <Input
                    id="connect-url"
                    placeholder="https://your-instance.my.connect.aws"
                    value={aws.connectInstanceUrl}
                    onChange={(e) => setAws({ ...aws, connectInstanceUrl: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Add this origin to the Connect instance's "Approved origins" list, otherwise the CCP
                    iframe will refuse to load.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AWS credentials</CardTitle>
                <CardDescription>
                  Used by Transcribe Streaming, Translate, and Polly. Stored in localStorage on this
                  machine only — for production deployments use Cognito Identity Pools instead.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="aws-region">Region</Label>
                  <Input
                    id="aws-region"
                    placeholder="us-east-1"
                    value={aws.region}
                    onChange={(e) => setAws({ ...aws, region: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-access-key">Access key ID</Label>
                  <Input
                    id="aws-access-key"
                    value={aws.accessKeyId}
                    onChange={(e) => setAws({ ...aws, accessKeyId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-secret-key">Secret access key</Label>
                  <Input
                    id="aws-secret-key"
                    type="password"
                    value={aws.secretAccessKey}
                    onChange={(e) => setAws({ ...aws, secretAccessKey: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-session-token">Session token (optional)</Label>
                  <Input
                    id="aws-session-token"
                    type="password"
                    value={aws.sessionToken ?? ""}
                    onChange={(e) => setAws({ ...aws, sessionToken: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save changes
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
