import React, { createContext, Dispatch, SetStateAction, useContext, useEffect, useReducer } from 'react';

const Scope = createContext('setup');
const values = new Map<string, unknown>();
const bases = new Map<string, string>();
const dirtyKeys = new Set<string>();
function report() { void window.desk.setUnsaved({ dirty: dirtyKeys.size > 0 }).catch(() => {}); }
export function SessionScope({ id, children }: { id: string; children: React.ReactNode }) { return <Scope.Provider value={id}>{children}</Scope.Provider>; }
export function useSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const scope = useContext(Scope), id = `${scope}:${key}`;
  const [, render] = useReducer(v => v + 1, 0);
  if (!values.has(id)) values.set(id, typeof initial === 'function' ? (initial as () => T)() : initial);
  const set: Dispatch<SetStateAction<T>> = next => {
    values.set(id, typeof next === 'function' ? (next as (value: T) => T)(values.get(id) as T) : next);
    render();
  };
  return [values.get(id) as T, set];
}
export function useDraft<T>(key: string, initial: () => T) {
  const scope = useContext(Scope), id = `${scope}:draft:${key}`;
  const [value, setValue] = useSessionState(`draft:${key}`, initial);
  if (!bases.has(id)) bases.set(id, JSON.stringify(value));
  const dirty = JSON.stringify(value) !== bases.get(id);
  useEffect(() => { if (dirty) dirtyKeys.add(id); else dirtyKeys.delete(id); report(); }, [id, dirty, value]);
  const fresh = JSON.stringify(initial());
  useEffect(() => {
    if (!dirty && fresh !== bases.get(id)) { bases.set(id, fresh); setValue(JSON.parse(fresh)); }
  }, [fresh]);
  const saved = (next?: T) => {
    const actual = next === undefined ? values.get(id) as T : next;
    bases.set(id, JSON.stringify(actual)); dirtyKeys.delete(id); setValue(actual); report();
  };
  const discard = () => saved(initial());
  return { value, set: setValue, dirty, saved, discard };
}
