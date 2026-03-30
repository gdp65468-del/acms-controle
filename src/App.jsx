import { Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useAppContext } from "./context/AppContext";
import { LandingPage } from "./pages/LandingPage";
import { TreasurerPage } from "./pages/TreasurerPage";
import { AssistantPage } from "./pages/AssistantPage";
import { PublicAdvancePage } from "./pages/PublicAdvancePage";
import { FilesPage } from "./pages/FilesPage";

function ProtectedTreasurerRoute({ element }) {
  const { loading, session } = useAppContext();
  if (loading) return <div className="screen-center">Carregando...</div>;
  if (!session.currentUser || session.currentUser.role !== "treasurer") return <Navigate to="/" replace />;
  return element;
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<ProtectedTreasurerRoute element={<TreasurerPage />} />} />
        <Route path="/arquivos" element={<ProtectedTreasurerRoute element={<FilesPage />} />} />
        <Route path="/auxiliar" element={<AssistantPage />} />
        <Route path="/publico/:token" element={<PublicAdvancePage />} />
      </Routes>
    </AppProvider>
  );
}
