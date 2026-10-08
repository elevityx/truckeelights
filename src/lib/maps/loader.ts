import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { publicEnv } from '@/config/public-env';

type GoogleLibs = {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  places: google.maps.PlacesLibrary;
};

let promise: Promise<GoogleLibs> | null = null;

/** One module-level promise, so map and autocomplete never race the loader. */
export function loadGoogle(): Promise<GoogleLibs> {
  if (!promise) {
    setOptions({ key: publicEnv.mapsKey, v: 'weekly' });
    promise = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('places')]).then(
      ([maps, marker, places]) => ({ maps, marker, places }),
    );
  }
  return promise;
}

let geocoder: Promise<google.maps.Geocoder> | null = null;

/** Lazily loads the geocoding library (only when someone taps the map to add a house). */
export function loadGeocoder(): Promise<google.maps.Geocoder> {
  if (!geocoder) {
    geocoder = loadGoogle()
      .then(() => importLibrary('geocoding'))
      .then((lib) => new lib.Geocoder());
    geocoder.catch(() => {
      geocoder = null; // allow a retry after a failed load
    });
  }
  return geocoder;
}
