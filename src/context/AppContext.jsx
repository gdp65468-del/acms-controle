import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { appService } from "../services/appService";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, setState] = useState({
    users: [],
    advances: [],
    authorizations: [],
    history: [],
    fileFolders: [],
    fileAssets: [],
    session: { currentUser: null, assistantUser: null }
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = appService.subscribeAppData((nextState) => {
      setState(nextState);
      setLoading(false);
    });
    return () => unsubscribe?.();
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      loading,
      message,
      setMessage,
      actions: appService
    }),
    [state, loading, message]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext deve ser usado dentro de AppProvider.");
  }
  return context;
}
