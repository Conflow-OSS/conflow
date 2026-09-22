import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignTemplatesTab } from "@/features/design-templates/DesignTemplatesTab";
import { GoldenPostsTab } from "@/features/golden-posts/GoldenPostsTab";

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium text-foreground">{label} is coming soon</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This lands alongside prompt customization, once this week's posts ship.
      </p>
    </div>
  );
}

export function PersonalizationPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Personalize</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your voice examples and card designs — what the AI matches when it writes for you.
        </p>
      </div>
      <Tabs defaultValue="golden-posts" className="flex flex-col gap-6 md:flex-row md:items-start">
        <TabsList className="flex h-auto w-full flex-row items-stretch justify-start gap-1 overflow-x-auto md:w-48 md:flex-col md:items-stretch">
          <TabsTrigger value="golden-posts" className="justify-start">
            Golden posts
          </TabsTrigger>
          <TabsTrigger value="design-templates" className="justify-start">
            Design templates
          </TabsTrigger>
          <TabsTrigger value="profile" className="justify-start">
            Profile
          </TabsTrigger>
          <TabsTrigger value="prompts" className="justify-start">
            Prompt customization
          </TabsTrigger>
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="golden-posts" className="mt-0">
            <GoldenPostsTab />
          </TabsContent>
          <TabsContent value="design-templates" className="mt-0">
            <DesignTemplatesTab />
          </TabsContent>
          <TabsContent value="profile" className="mt-0">
            <ComingSoon label="Profile" />
          </TabsContent>
          <TabsContent value="prompts" className="mt-0">
            <ComingSoon label="Prompt customization" />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
