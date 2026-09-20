"use client"

import { useLocale, useTranslations } from "next-intl"
import type { IpLocation } from "@/lib/ip-location-types"

export function useIpLocationLabel() {
  const locale = useLocale(), t = useTranslations("profile.security.sessions.geo")
  return (location?: IpLocation, loading = false) => {
    if (!location) return t(loading ? "loading" : "unavailable")
    if (location.status !== "success") return t(location.status)
    let country = location.country || location.countryCode
    if (location.countryCode) {
      try { country = new Intl.DisplayNames([locale], { type: "region" }).of(location.countryCode) || country } catch { /* Keep the provider's country name. */ }
    }
    return [...new Set([country, location.region, location.city].filter(Boolean))].join(t("separator"))
  }
}

export function SessionLocationDetails({ location, title }: { location?: IpLocation; title: string }) {
  const t = useTranslations("profile.security.sessions.geo")
  if (location?.status !== "success") return null
  const fields = [
    [t("postal"), location.postal], [t("organization"), location.organization], [t("timezone"), location.timezone],
    [t("coordinates"), location.latitude !== undefined && location.longitude !== undefined ? `${location.latitude}, ${location.longitude}` : undefined],
    [t("accuracy"), location.accuracyKm !== undefined ? t("kilometers", { value: location.accuracyKm }) : undefined],
    [t("source"), location.source],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  return <div className="col-span-2 min-w-0 rounded bg-muted/30 p-2">
    <p className="mb-2 font-medium">{title} · {t("title")}</p>
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">{fields.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
  </div>
}
