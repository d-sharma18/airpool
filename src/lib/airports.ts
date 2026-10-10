export interface Airport {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

/** Major Indian airports. Pickup point for every pool at that airport. */
export const AIRPORTS: Airport[] = [
  { iata: "DEL", name: "Indira Gandhi Intl", city: "Delhi", lat: 28.5562, lng: 77.1 },
  { iata: "BOM", name: "Chhatrapati Shivaji Maharaj Intl", city: "Mumbai", lat: 19.0896, lng: 72.8656 },
  { iata: "NMI", name: "Navi Mumbai Intl", city: "Navi Mumbai", lat: 18.9917, lng: 73.0711 },
  { iata: "BLR", name: "Kempegowda Intl", city: "Bengaluru", lat: 13.1986, lng: 77.7066 },
  { iata: "MAA", name: "Chennai Intl", city: "Chennai", lat: 12.9941, lng: 80.1709 },
  { iata: "HYD", name: "Rajiv Gandhi Intl", city: "Hyderabad", lat: 17.2403, lng: 78.4294 },
  { iata: "CCU", name: "Netaji Subhas Chandra Bose Intl", city: "Kolkata", lat: 22.6547, lng: 88.4467 },
  { iata: "COK", name: "Cochin Intl", city: "Kochi", lat: 10.152, lng: 76.4019 },
  { iata: "AMD", name: "Sardar Vallabhbhai Patel Intl", city: "Ahmedabad", lat: 23.0772, lng: 72.6347 },
  { iata: "PNQ", name: "Pune Intl", city: "Pune", lat: 18.5821, lng: 73.9197 },
  { iata: "GOI", name: "Goa Intl (Dabolim)", city: "Goa", lat: 15.3808, lng: 73.8314 },
  { iata: "GOX", name: "Manohar Intl (Mopa)", city: "Goa", lat: 15.7442, lng: 73.8606 },
  { iata: "JAI", name: "Jaipur Intl", city: "Jaipur", lat: 26.8242, lng: 75.8122 },
  { iata: "LKO", name: "Chaudhary Charan Singh Intl", city: "Lucknow", lat: 26.7606, lng: 80.8893 },
  { iata: "TRV", name: "Thiruvananthapuram Intl", city: "Thiruvananthapuram", lat: 8.4821, lng: 76.9201 },
  { iata: "IXC", name: "Chandigarh Intl", city: "Chandigarh", lat: 30.6735, lng: 76.7885 },
  { iata: "ATQ", name: "Sri Guru Ram Dass Jee Intl", city: "Amritsar", lat: 31.7096, lng: 74.7973 },
  { iata: "GAU", name: "Lokpriya Gopinath Bordoloi Intl", city: "Guwahati", lat: 26.1061, lng: 91.5859 },
  { iata: "BBI", name: "Biju Patnaik Intl", city: "Bhubaneswar", lat: 20.2444, lng: 85.8178 },
  { iata: "PAT", name: "Jay Prakash Narayan", city: "Patna", lat: 25.5913, lng: 85.088 },
  { iata: "IDR", name: "Devi Ahilyabai Holkar", city: "Indore", lat: 22.7218, lng: 75.8011 },
  { iata: "NAG", name: "Dr. Babasaheb Ambedkar Intl", city: "Nagpur", lat: 21.0922, lng: 79.0472 },
  { iata: "CJB", name: "Coimbatore Intl", city: "Coimbatore", lat: 11.03, lng: 77.0434 },
  { iata: "IXB", name: "Bagdogra", city: "Siliguri", lat: 26.6812, lng: 88.3286 },
  { iata: "VNS", name: "Lal Bahadur Shastri Intl", city: "Varanasi", lat: 25.4524, lng: 82.8593 },
  { iata: "SXR", name: "Sheikh ul-Alam Intl", city: "Srinagar", lat: 33.9871, lng: 74.7742 },
];

export function airportByIata(iata?: string | null) {
  if (!iata) return undefined;
  return AIRPORTS.find((a) => a.iata === iata.toUpperCase());
}
