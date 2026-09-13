import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { GeneratePage } from "@/pages/GeneratePage";
import { PostDetailPage } from "@/pages/PostDetailPage";
import { PostsPage } from "@/pages/PostsPage";
import { RunDetailPage } from "@/pages/RunDetailPage";
import { RunsPage } from "@/pages/RunsPage";
import { SeedPage } from "@/pages/SeedPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/posts" element={<PostsPage />} />
        <Route path="/posts/:postId" element={<PostDetailPage />} />
        <Route path="/seed" element={<SeedPage />} />
        <Route path="/generate" element={<GeneratePage />} />
      </Route>
    </Routes>
  );
}
