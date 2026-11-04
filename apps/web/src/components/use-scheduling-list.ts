"use client";

import { useEffect, useState } from "react";

/** Independent URL keys let the request register and calendar share one page. */
export function useSchedulingList(prefix: string) {
  const [page, setPageState] = useState(1);
  const [search, setSearchState] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedPage = Number(params.get(`${prefix}Page`));
    if (Number.isInteger(savedPage) && savedPage > 0 && savedPage <= 100000) setPageState(savedPage);
    const savedSearch = params.get(`${prefix}Search`)?.slice(0, 120) ?? "";
    setSearchState(savedSearch); setFilter(savedSearch);
  }, [prefix]);
  useEffect(() => { const timer = setTimeout(() => setFilter(search), 300); return () => clearTimeout(timer); }, [search]);
  function save(nextPage: number, nextSearch: string) {
    const params = new URLSearchParams(window.location.search);
    params.set(`${prefix}Page`, String(nextPage));
    if (nextSearch) params.set(`${prefix}Search`, nextSearch); else params.delete(`${prefix}Search`);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  }
  return { page, search, filter,
    setPage(nextPage: number) { setPageState(nextPage); save(nextPage, search); },
    setSearch(nextSearch: string) { setSearchState(nextSearch.slice(0, 120)); setPageState(1); save(1, nextSearch.slice(0, 120)); },
  };
}
