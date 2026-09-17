import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { UploadPage } from "@/pages/UploadPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/po/:id" element={<ReviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
