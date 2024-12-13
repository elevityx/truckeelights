import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { ref, getDownloadURL, listAll } from "firebase/storage";
import { storage } from "../firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";

/**
 * Fetches all houses from Firestore.
 * @returns {Promise<Array>} List of houses.
 */
export const fetchHouses = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, "houses"));
    const houses = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return houses;
  } catch (error) {
    console.error("Error fetching houses:", error);
    return [];
  }
};

/**
 * Creates a marker with an emoji icon on the map.
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Object} house - The house data containing location and other info.
 * @param {Function} onClickCallback - The function to call when the marker is clicked.
 * @returns {google.maps.Marker|null} - The created marker or null if creation failed.
 */
export const createEmojiMarker = (map, house, onClickCallback) => {
  if (!house.location || !house.location.lat || !house.location.lng) {
    console.error("Invalid house location:", house);
    return null;
  }

  const position = new google.maps.LatLng(house.location.lat, house.location.lng);

  const marker = new google.maps.Marker({
    position: position,
    map: map,
    // Use a custom SVG icon to represent the emoji 🎄 (Christmas Tree)
    icon: {
      // SVG data URL for the emoji 🎄 (Christmas Tree)
      url:
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <text x="16" y="24" text-anchor="middle" font-size="24">&#127876;</text>
          </svg>
        `),
      scaledSize: new google.maps.Size(32, 32), // Adjust size as needed
      anchor: new google.maps.Point(16, 32), // Anchor point of the icon
    },
    clickable: true,
  });

  if (onClickCallback) {
    marker.addListener("click", () => onClickCallback(marker, house));
  }

  return marker;
};

/**
 * Initializes and returns a new InfoWindow instance.
 * @returns {google.maps.InfoWindow|null} - The InfoWindow instance or null if creation failed.
 */
export const initializeInfoWindow = () => {
  if (typeof google === "undefined") {
    console.error("Google Maps API is not loaded.");
    return null;
  }

  return new google.maps.InfoWindow();
};

/**
 * Opens the InfoWindow with the provided content at the specified marker.
 * @param {google.maps.InfoWindow} infoWindow - The InfoWindow instance.
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {google.maps.Marker} marker - The marker at which to display the InfoWindow.
 * @param {string} content - The HTML content to display in the InfoWindow.
 */
export const openInfoWindow = (infoWindow, map, marker, content) => {
  infoWindow.setContent(content);
  infoWindow.open(map, marker);
};

/**
 * Fetches all photo URLs for a given house from Firebase Storage.
 * @param {string} houseId - The ID of the house.
 * @returns {Promise<Array>} - An array of photo URLs.
 */
export const fetchHousePhotos = async (houseId) => {
  const photosRef = ref(storage, `houses/${houseId}/photos`);
  try {
    const result = await listAll(photosRef);
    const urlPromises = result.items.map((itemRef) => getDownloadURL(itemRef));
    const urls = await Promise.all(urlPromises);
    return urls;
  } catch (error) {
    console.error("Error fetching photos:", error);
    return [];
  }
};

/**
 * Generates the HTML content for the house InfoWindow.
 * @param {Object} house - The house data.
 * @param {Array} photos - Array of photo URLs.
 * @returns {string} - The HTML content for the InfoWindow.
 */
export const generateInfoWindowContent = (house, photos) => {
  const { address, id } = house;

  // Escape HTML to prevent XSS
  const escapeHtml = (unsafe) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const safeAddress = escapeHtml(address || "No Address Provided");

  // Start constructing the HTML content
  let content = `
    <div class="min-w-[250px] p-4 rounded-lg bg-christmasGreen text-snowWhite font-sans">
  `;

  // Photos section
  if (photos && photos.length > 0) {
    content += `
      <div class="flex overflow-x-auto space-x-2 mb-4">
        ${photos
          .map(
            (url, index) => `
            <img
              src="${url}"
              alt="Photo of ${safeAddress}"
              class="w-20 h-20 object-cover rounded cursor-pointer"
              data-photo-index="${index}"
            />
          `
          )
          .join('')}
      </div>
    `;
  } else {
    content += `<p class="mb-4">No photos available.</p>`;
  }

  // Address
  content += `
    <h3 class="text-lg font-bold text-gold mb-2">${safeAddress}</h3>
  `;

  // Add Photos button
  content += `
    <button id="upload-photos-btn-${id}" class="w-full py-2 px-4 bg-gold text-christmasGreen font-semibold rounded hover:bg-snowWhite transition duration-200">
      📷 Upload Photos
    </button>
  `;

  content += `</div>`;

  return content;
};

/**
 * Creates a styled InfoWindow for adding a house.
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {google.maps.LatLng} latLng - The location at which to display the InfoWindow.
 * @param {Function} handleUserSelection - Callback function when user adds the house.
 * @param {string} address - The resolved address of the location.
 * @returns {google.maps.InfoWindow} - The created InfoWindow instance.
 */
export const createStyledInfoWindow = (map, latLng, handleUserSelection, address) => {
  if (typeof google === "undefined") {
    console.error("Google Maps API is not loaded.");
    return null;
  }

  // Create a container div
  const containerDiv = document.createElement('div');
  containerDiv.classList.add(
    "min-w-[250px]",
    "p-4",
    "rounded-lg",
    "bg-christmasGreen",
    "text-snowWhite",
    "font-sans"
  );

  // Add content to the container
  containerDiv.innerHTML = `
    <h3 class="text-xl font-bold text-gold mb-2">🎄 Add This House?</h3>
    <p class="mb-4">${address}</p>
    <button class="w-full py-2 px-4 bg-gold text-christmasGreen font-semibold rounded hover:bg-snowWhite transition duration-200">
      🎉 Yes, Add House
    </button>
  `;

  // Attach event listener to the button
  const addButton = containerDiv.querySelector('button');
  if (addButton) {
    addButton.addEventListener('click', () => {
      handleUserSelection(address, latLng.toJSON());
      infoWindow.close();
    });
  } else {
    console.error("Could not find the add-house button");
  }

  // Create and open the InfoWindow
  const infoWindow = new google.maps.InfoWindow({
    content: containerDiv,
    position: latLng,
  });

  infoWindow.open(map);

  return infoWindow;
};

