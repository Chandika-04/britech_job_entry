import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { JobPage } from "@/pages/JobPage";
import { ManualEntryPage } from "@/pages/ManualEntryPage";
import { NewPoPage } from "@/pages/NewPoPage";
import { NewPartPage } from "@/pages/NewPartPage";
import { PartEditorPage } from "@/pages/PartEditorPage";
import { PartsPage } from "@/pages/PartsPage";
import { PurchaseOrdersPage } from "@/pages/PurchaseOrdersPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { ShipperPage } from "@/pages/ShipperPage";
import { ShippersPage } from "@/pages/ShippersPage";
import { UploadPage } from "@/pages/UploadPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/shippers" element={<ShippersPage />} />
          <Route path="/shippers/:shipNumber" element={<ShipperPage />} />
          <Route path="/new" element={<NewPoPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/manual" element={<ManualEntryPage />} />
          <Route path="/manual/:id" element={<ManualEntryPage />} />
          <Route path="/po/:id" element={<ReviewPage />} />
          <Route path="/jobs/:jobNumber" element={<JobPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/parts/new" element={<NewPartPage />} />
          <Route path="/parts/:pmLinkId" element={<PartEditorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
