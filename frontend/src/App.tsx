import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
const Board = lazy(() => import("./pages/Board"));

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading" role="status">Loading board…</div>}><Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/b/:boardId" element={<Board />} />
    </Routes></Suspense>
  );
}
