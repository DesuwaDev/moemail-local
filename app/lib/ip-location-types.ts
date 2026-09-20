export interface IpLocation {
  status: "success" | "unavailable" | "private"
  countryCode?: string
  country?: string
  region?: string
  city?: string
  postal?: string
  organization?: string
  timezone?: string
  latitude?: number
  longitude?: number
  accuracyKm?: number
  source?: "GeoJS" | "ipwho.is" | "country.is"
}
