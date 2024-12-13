import React, { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import {
  createEmojiMarker,
  fetchHousePhotos,
  generateInfoWindowContent,
  initializeInfoWindow,
  createStyledInfoWindow,
  openInfoWindow,
} from "../utils/mapUtils";
import { db, storage } from "../firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import dynamic from 'next/dynamic';
import { resizeImage } from "../utils/imageUtils";

const Map = ({ houses, addMarker, selectedHouse, onSelectHouse }) => {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);

  const infoWindowRef = useRef(null); // Ref for house InfoWindow
  const addHouseInfoWindowRef = useRef(null); // Ref for "Add House" InfoWindow
  const markersRef = useRef([]); // Array of markers
  const markersMapRef = useRef({}); // Mapping of house ID to marker

  /**
   * Smoothly zooms the map to the target zoom level.
   */
  const smoothZoom = (map, targetZoom, step = 1, interval = 100) => {
    const currentZoom = map.getZoom();
    if (currentZoom === targetZoom) return;

    const zoomStep = currentZoom < targetZoom ? step : -step;

    const zoomTimer = setInterval(() => {
      const newZoom = map.getZoom() + zoomStep;
      if (
        (zoomStep > 0 && newZoom >= targetZoom) ||
        (zoomStep < 0 && newZoom <= targetZoom)
      ) {
        map.setZoom(targetZoom);
        clearInterval(zoomTimer);
      } else {
        map.setZoom(newZoom);
      }
    }, interval);
  };

  useEffect(() => {
    const loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
      version: "weekly",
      libraries: ["places"],
    });

    const initMap = async () => {
      try {
        await loader.load();

        if (typeof google === "undefined") {
          console.error("Google Maps API failed to load.");
          return;
        }

        const mapInstance = new google.maps.Map(mapRef.current, {
          center: { lat: 39.326, lng: -120.183 },
          zoom: 12,
        });

        // Initialize the InfoWindow for houses
        infoWindowRef.current = initializeInfoWindow();

        if (!infoWindowRef.current) {
          console.error("Failed to initialize InfoWindow.");
          return;
        }

        // Add existing markers to the map
        houses.forEach((house) => {
          const marker = createEmojiMarker(mapInstance, house, showHouseInfoWindow);
          markersRef.current.push(marker);
          markersMapRef.current[house.id] = marker;
        });

        // Map Click Listener
        mapInstance.addListener("click", (event) => {
          const latLng = event.latLng;

          // Close any open 'Add House' InfoWindow
          if (addHouseInfoWindowRef.current) {
            addHouseInfoWindowRef.current.close();
            addHouseInfoWindowRef.current = null;
            return; // Do not open a new InfoWindow when closing the existing one
          }

          // Close any open house InfoWindow
          if (infoWindowRef.current) {
            infoWindowRef.current.close();
          }

          // Smooth Zoom and Pan to Click Location
          mapInstance.panTo(latLng);
          smoothZoom(mapInstance, 17);

          // Perform Geocoding
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: latLng }, (results, status) => {
            if (status === "OK") {
              const resolvedAddress = results[0]?.formatted_address || "Address Not Found";

              // Create a new 'Add House' InfoWindow and store the reference
              addHouseInfoWindowRef.current = createStyledInfoWindow(
                mapInstance,
                latLng,
                handleUserSelection,
                resolvedAddress
              );

              // Add event listener for when the InfoWindow is manually closed
              google.maps.event.addListener(addHouseInfoWindowRef.current, "closeclick", () => {
                addHouseInfoWindowRef.current = null;
              });
            } else {
              console.error("Geocode error:", status);
              alert("Unable to determine the address for this location.");
            }
          });
        });

        // Set the map instance
        setMap(mapInstance);
      } catch (error) {
        console.error("Google Maps API error:", error);
      }
    };

    initMap();
  }, [houses]);

  // Handle selection of a house via sidebar
  useEffect(() => {
    if (map && selectedHouse) {
      // Close any existing 'Add House' InfoWindow
      if (addHouseInfoWindowRef.current) {
        addHouseInfoWindowRef.current.close();
        addHouseInfoWindowRef.current = null;
      }

      // Close any existing house InfoWindow
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
      }

      const house = houses.find((h) => h.id === selectedHouse);

      if (house) {
        const marker = markersMapRef.current[house.id];
        if (marker) {
          showHouseInfoWindow(marker, house);

          // Pan and zoom to the selected house
          map.panTo(new google.maps.LatLng(house.location.lat, house.location.lng));
          smoothZoom(map, 15);
        }
      }
    }
  }, [selectedHouse, houses, map]);

  // Handles user selection when adding a new house via map click.
  const handleUserSelection = (address, location) => {
    addMarker(address, location);

    // Close the 'Add House' InfoWindow and reset the reference
    if (addHouseInfoWindowRef.current) {
      addHouseInfoWindowRef.current.close();
      addHouseInfoWindowRef.current = null;
    }
  };

  // Creates and displays the InfoWindow for a house marker.
  const showHouseInfoWindow = async (marker, house) => {
    // Close any open 'Add House' InfoWindow
    if (addHouseInfoWindowRef.current) {
      addHouseInfoWindowRef.current.close();
      addHouseInfoWindowRef.current = null;
    }

    // Close existing house InfoWindow
    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }

    const photos = await fetchHousePhotos(house.id);

    // Generate HTML content for the Info Window
    const content = generateInfoWindowContent(house, photos);

    // Set the content and open the InfoWindow
    openInfoWindow(infoWindowRef.current, map, marker, content);

    // Smooth Zoom and Pan to House Location
    map.panTo(new google.maps.LatLng(house.location.lat, house.location.lng));
    smoothZoom(map, 15);

    // Close InfoWindow when clicking elsewhere on the map
    google.maps.event.addListenerOnce(map, "click", () => {
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
      }
    });

    // Add event listeners for uploading photos and image clicks
    google.maps.event.addListenerOnce(infoWindowRef.current, "domready", () => {
      // Upload Photos Button Logic
      const uploadPhotosBtn = document.getElementById(`upload-photos-btn-${house.id}`);

      if (uploadPhotosBtn) {
        uploadPhotosBtn.addEventListener("click", async () => {
          try {
            // Disable the button to prevent multiple uploads
            uploadPhotosBtn.disabled = true;

            // Create a file input element dynamically
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.multiple = true;

            // Listen for file selection
            fileInput.onchange = async () => {
              const files = Array.from(fileInput.files);
              if (files.length === 0) {
                alert("No files selected.");
                uploadPhotosBtn.disabled = false;
                return;
              }

              // Show a loading indicator
              const loadingIndicator = document.createElement('div');
              loadingIndicator.id = 'loading-indicator';
              loadingIndicator.innerText = 'Uploading photos...';
              loadingIndicator.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: rgba(0, 0, 0, 0.8);
                color: #ecf0f1;
                padding: 20px;
                border-radius: 8px;
                z-index: 1000;
              `;
              document.body.appendChild(loadingIndicator);

              try {
                // Upload each selected file to Firebase Storage with optimization
                const uploadPromises = files.map(async (file) => {
                  // Resize and compress the image before upload
                  const optimizedFile = await resizeImage(file);

                  // Log the optimized file name
                  console.log("Original File Name:", file.name);
                  console.log("Optimized File Name:", optimizedFile.name);

                  if (!optimizedFile.name) {
                    throw new Error("optimizedFile.name is undefined.");
                  }

                  // Corrected Storage Path: Include 'photos' subdirectory
                  const storageRef = ref(storage, `houses/${house.id}/photos/${optimizedFile.name}`);
                  const uploadTask = uploadBytesResumable(storageRef, optimizedFile);

                  // Optional: Monitor upload progress
                  uploadTask.on('state_changed', (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    console.log(`Upload is ${progress}% done`);
                    // Optionally, update a progress bar here
                  });

                  // Wait for upload to complete
                  await uploadTask;

                  // Get the download URL
                  const downloadURL = await getDownloadURL(storageRef);

                  // Add photo metadata to Firestore subcollection
                  await addDoc(collection(db, 'houses', house.id, 'photos'), {
                    downloadURL,
                    storagePath: storageRef.fullPath,
                    uploadedAt: serverTimestamp(),
                    fileName: optimizedFile.name,
                  });
                });

                await Promise.all(uploadPromises);
                alert("Photos uploaded successfully.");
              } catch (error) {
                console.error("Error uploading photos:", error);
                alert("An error occurred while uploading photos.");
              } finally {
                // Remove the loading indicator and re-enable the button
                document.body.removeChild(loadingIndicator);
                uploadPhotosBtn.disabled = false;

                // Refresh the photos in the InfoWindow
                const updatedPhotos = await fetchHousePhotos(house.id);
                const updatedContent = generateInfoWindowContent(house, updatedPhotos);
                openInfoWindow(infoWindowRef.current, map, marker, updatedContent);
              }
            };

            // Trigger the file input dialog
            fileInput.click();
          } catch (error) {
            console.error("Error initiating photo upload:", error);
            alert("An error occurred while initiating photo upload.");
            uploadPhotosBtn.disabled = false;
          }
        });
      }

      // Photo Click Logic
      const images = document.querySelectorAll(".gm-style-iw img[data-photo-index]");
      images.forEach((img) => {
        img.addEventListener("click", () => {
          const url = img.src;
          // Create a modal popup to display the larger image
          const modal = document.createElement('div');
          modal.id = 'photo-modal';
          modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          `;
          modal.innerHTML = `
            <img src="${url}" style="max-width: 90%; max-height: 90%; border: 5px solid white; border-radius: 8px; cursor: pointer;" />
          `;
          document.body.appendChild(modal);

          // Close modal when clicking on the image or outside
          modal.addEventListener('click', () => {
            document.body.removeChild(modal);
          });
        });
      });
    });
  };

    /**
     * Centers the map on the selected house and opens its Info Window.
     * @param {Object} house - The house to focus on.
     */
    const focusOnHouse = (house) => {
        if (!map) return; // Ensure the map is loaded

        const position = new google.maps.LatLng(house.location.lat, house.location.lng);

        if (map) {
            map.panTo(position);
            map.setZoom(17); // Adjust the zoom level as needed
        }

        if (house.id === "temp") {
            // For temporary house, invoke the 'createStyledInfoWindow' to get user input
            createStyledInfoWindow(map, position, handleUserSelection, house.address);
        } else {
            const marker = markersMapRef.current[house.id];
            if (marker) {
                showHouseInfoWindow(marker, house);
            }
        }
    };

    // Effect to render markers on houses change
    useEffect(() => {
        if (!map) return;

        // Clear existing markers
        markersRef.current.forEach(marker => marker.setMap(null));
        markersRef.current = [];
        markersMapRef.current = {};

        // Add new markers
        houses.forEach(house => {
            // Ensure house has necessary data
            if (!house.location || !house.location.lat || !house.location.lng) {
                console.error("House is missing location data:", house);
                return;
            }

            const marker = createEmojiMarker(map, house, showHouseInfoWindow);
            if (marker) {
                markersRef.current.push(marker);
                markersMapRef.current[house.id] = marker;
            }
        });
    }, [houses, map]);

    // Updated Effect to handle 'selectedHouse' changes
    useEffect(() => {
        if (selectedHouse && map) {
            const { location, id } = selectedHouse;

            // Center the map on the selected house
            // Start of Selection
            map.panTo({ lat: location.lat, lng: location.lng });

            // Zoom in if necessary
            map.setZoom(17);

            if (id) {
                // House exists in database, find its marker
                const marker = markersMapRef.current[id];
                if (marker) {
                    // Open InfoWindow on existing marker
                    showHouseInfoWindow(marker, selectedHouse);
                }
            } else {
                // House not in database, prompt user to add the house
                createStyledInfoWindow(
                    map,
                    new google.maps.LatLng(location.lat, location.lng),
                    (address, location) => {
                        // User confirmed to add the house
                        addMarker(address, location);
                        // After adding, you might want to setSelectedHouse with new house data
                        // Depending on how addMarker updates the houses state
                    },
                    selectedHouse.address
                );
            }
        }
    }, [selectedHouse, map]);

    return <div id="map" ref={mapRef} className="h-full w-full" />;
};

export default Map;