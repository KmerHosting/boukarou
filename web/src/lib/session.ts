import { createContext, useContext } from "react";
import type { User } from "./types";

export type Session = {
  user: User | null;
  version: string;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
};
export const SessionCtx = createContext<Session>({ user: null, version: "", refresh: async () => {}, setUser: () => {} });
export const useSession = () => useContext(SessionCtx);
