import { collection, getDocs, query, orderBy } from "firebase/firestore";
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
    // Use a custom SVG icon to represent the emoji
    icon: {
      // SVG data URL for the emoji 🎄 (Christmas Tree)
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
          <text x="16" y="24" text-anchor="middle" font-size="24">&#127876;</text>
        </svg>
      `),
      scaledSize: new google.maps.Size(32, 32), // Adjust size as needed
      anchor: new google.maps.Point(16, 32), // Anchor point of the icon
    },
    // Ensure label is set correctly
    label: "", // Set label to an empty string to prevent any text label
    // Make the marker clickable
    clickable: true,
  });

  if (onClickCallback) {
    marker.addListener("click", () => onClickCallback(marker, house));
  }

  return marker;
};

/**
 * Fetches photo URLs for a given house from Firestore.
 * @param {string} houseId - The ID of the house.
 * @returns {Promise<string[]>} Array of photo URLs.
 */
export const fetchHousePhotos = async (houseId) => {
  try {
    const photosCollectionRef = collection(db, 'houses', houseId, 'photos');
    const photosQuery = query(photosCollectionRef, orderBy('uploadedAt', 'desc')); // Optional: Order photos by upload time
    const photosSnapshot = await getDocs(photosQuery);

    const photoUrls = photosSnapshot.docs
      .map((doc) => doc.data().downloadURL)
      .filter((url) => !!url); // Filters out undefined or null URLs

    return photoUrls;
  } catch (error) {
    console.error(`Error fetching photos for house ID "${houseId}":`, error);
    return [];
  }
};

/**
 * Generates HTML content for the Info Window.
 * @param {Object} house - The house data.
 * @param {Array<string>} photos - Array of photo URLs.
 * @returns {string} HTML string for the Info Window.
 */
export const generateInfoWindowContent = (house, photos) => {
  const { address } = house;

  // Helper function to escape HTML to prevent XSS
  const escapeHtml = (unsafe) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Sanitize address
  const safeAddress = escapeHtml(address || "No Address Provided");

  // Start constructing the HTML content
  let content = `
    <div style="min-width:250px; font-family: Arial, sans-serif;">
      <h3 style="margin-top: 0; color: #2c3e50;">${safeAddress}</h3>
  `;

  // Add photos section
  if (photos && photos.length > 0) {
    content += `
      <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;">
        ${photos
          .map(
            (url) => `
          <img 
            src="${url}" 
            alt="Photo of ${safeAddress}" 
            style="width: 80px; height: 80px; object-fit: cover; border: 1px solid #bdc3c7; border-radius: 4px;"
            loading="lazy"
          />
        `
          )
          .join('')}
      </div>
    `;
  } else {
    content += `<p style="color: #7f8c8d;">No photos available.</p>`;
  }

  // Add upload photos button
  content += `
      <button id="upload-photos-btn-${house.id}" style="
          padding: 8px 12px;
          background-color: #2980b9;
          color: #ecf0f1;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: bold;
          width: 100%;
          text-align: left;
          margin-top: 10px;
          transition: background-color 0.3s;
      " 
      onmouseover="this.style.backgroundColor='#1c5980';" 
      onmouseout="this.style.backgroundColor='#2980b9';"
      >
        📷 Upload Photos
      </button>
    </div>
  `;

  return content;
};

/**
 * Initializes a single InfoWindow instance to be reused.
 * @returns {google.maps.InfoWindow} - The initialized InfoWindow.
 */
export const initializeInfoWindow = () => {
    return new google.maps.InfoWindow();
};

/**
 * Sets content and opens the InfoWindow.
 * @param {google.maps.InfoWindow|null} infoWindow - The InfoWindow instance.
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {google.maps.Marker} marker - The marker that was clicked.
 * @param {string} content - HTML content to display inside the InfoWindow.
 */
export const openInfoWindow = (infoWindow, map, marker, content) => {
  if (!infoWindow) {
    console.error("InfoWindow is not initialized.");
    return;
  }
  infoWindow.setContent(content);
  infoWindow.open(map, marker);
};

/**
 * Creates and displays a styled InfoWindow on the map for user input.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {google.maps.LatLng} latLng - The latitude and longitude where the InfoWindow should appear.
 * @param {Function} handleUserSelection - Callback function to handle user interactions.
 */
export const createStyledInfoWindow = (map, latLng, handleUserSelection, address = null) => {
  if (typeof google === "undefined") {
    console.error("Google Maps API is not loaded.");
    return;
  }

  const displayInfoWindow = (resolvedAddress) => {
    const contentString = `
      <div style="
          font-family: 'Mountains of Christmas', cursive;
          color: #ecf0f1; /* snowWhite */
          padding: 15px;
          background-color: #27ae60; /* christmasGreen */
          border-radius: 10px;
          max-width: 200px;
      ">
          <p style="font-weight: bold; font-size: 20px; color: #f1c40f; margin-top: 0;"> Address:</p>
          <p style="margin-bottom: 15px;">${resolvedAddress}</p>
          <p style="margin-bottom: 10px;">Add this house to the map?</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
              <button id="add-house-btn" style="
                  padding: 8px 12px;
                  background-color: #c0392b; /* christmasRed */
                  color: #ecf0f1; /* snowWhite */
                  border: none;
                  border-radius: 5px;
                  cursor: pointer;
                  font-weight: bold;
                  width: 100%;
                  text-align: left;
              ">
                  🎉 Yes, Add House
              </button>
          </div>
      </div>
    `;

    const infoWindow = new google.maps.InfoWindow({
      content: contentString,
      position: latLng,
    });

    infoWindow.open(map);

    // Add event listener to the button inside InfoWindow
    google.maps.event.addListenerOnce(infoWindow, "domready", () => {
      document
        .getElementById("add-house-btn")
        .addEventListener("click", () => {
          handleUserSelection(resolvedAddress, latLng.toJSON());
          infoWindow.close();
        });
    });
  };

  if (address) {
    // Address is already provided, use it directly
    displayInfoWindow(address);
  } else {
    // Geocode to get the address from latLng
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: latLng }, (results, status) => {
      if (status === "OK") {
        const resolvedAddress = results[0]?.formatted_address;
        if (resolvedAddress) {
          displayInfoWindow(resolvedAddress);
        } else {
          alert("No address found for this location.");
        }
      } else {
        console.error("Geocode error:", status);
      }
    });
  }
};
