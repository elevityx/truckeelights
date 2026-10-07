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
