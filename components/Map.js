import React, { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { 
    createEmojiMarker, 
    fetchHousePhotos, 
    generateInfoWindowContent, 
    initializeInfoWindow,
    createStyledInfoWindow,
    openInfoWindow
} from "../utils/mapUtils"; // Ensure this file does not import client-side libraries
import { db, storage } from "../firebase"; // Ensure correct import
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import dynamic from 'next/dynamic';
import { resizeImage } from "../utils/imageUtils"; // Import the resizeImage function

// Dynamically import imageUtils.js only on the client side within event handlers
const Map = ({ houses, addMarker, selectedHouse, onSelectHouse }) => {
    const mapRef = useRef(null);
    const [map, setMap] = useState(null);
    const infoWindowRef = useRef(null); // Ref for InfoWindow
    const markersRef = useRef([]); // Keep track of markers

    // Mapping of house ID to marker for easy access
    const markersMapRef = useRef({});

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

                infoWindowRef.current = initializeInfoWindow();

                if (!infoWindowRef.current) {
                    console.error("Failed to initialize InfoWindow.");
                    return;
                }

                // Handle map clicks to allow user to add new houses
                mapInstance.addListener("click", (event) => {
                    const latLng = event.latLng;
                    createStyledInfoWindow(mapInstance, latLng, handleUserSelection);
                });

                setMap(mapInstance);
            } catch (error) {
                console.error("Google Maps API error:", error);
            }
        };

        initMap();
    }, []);

    /**
     * Handles user selection when adding a new house via map click.
     * @param {string} address - The address of the house.
     * @param {Object} location - The latitude and longitude of the house.
     */
    const handleUserSelection = (address, location) => {
        console.log("User selection:", { address, location });
        addMarker(address, location); // Correct usage: only address and location
        // The parent component will handle updating the 'houses' state and re-rendering markers
    };

    /**
     * Creates and displays the InfoWindow for a house marker.
     * @param {google.maps.Marker} marker - The marker associated with the house.
     * @param {Object} house - The house data.
     */
    const showHouseInfoWindow = async (marker, house) => {
        const photos = await fetchHousePhotos(house.id); // Ensure correct parameter

        // Generate HTML content for the Info Window
        const content = generateInfoWindowContent(house, photos);

        // Set the content and open the Info Window
        openInfoWindow(infoWindowRef.current, map, marker, content);

        // Add event listeners for uploading photos
        google.maps.event.addListenerOnce(infoWindowRef.current, "domready", () => {
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
                                    const optimizedFile = await resizeImage(file); // Optimize image

                                    // Log the optimized file name
                                    console.log("Original File Name:", file.name);
                                    console.log("Optimized File Name:", optimizedFile.name);

                                    if (!optimizedFile.name) {
                                        throw new Error("optimizedFile.name is undefined.");
                                    }

                                    const storageRef = ref(storage, `houses/${house.id}/${optimizedFile.name}`);
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
            map.setZoom(15); // Adjust the zoom level as needed
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
        if (selectedHouse) {
            const { location, id } = selectedHouse;

            // Center the map on the selected house
            map.panTo(new google.maps.LatLng(location.lat, location.lng));

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
    }, [selectedHouse]);

    // Allow user to add a house by clicking on the map
    useEffect(() => {
        if (!map) return;

        const handleMapClick = (e) => {
            const clickedLocation = e.latLng.toJSON();
            const geocoder = new google.maps.Geocoder();

            geocoder.geocode({ location: clickedLocation }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const address = results[0].formatted_address;
                    const newHouse = {
                        id: null, // Not yet in DB
                        address: address,
                        normalizedAddress: address.trim().toLowerCase(),
                        location: clickedLocation,
                    };
                    onSelectHouse(newHouse);
                } else {
                    alert('Geocode was not successful for the following reason: ' + status);
                }
            });
        };

        map.addListener('click', handleMapClick);

        // Clean up the listener on unmount
        return () => {
            google.maps.event.clearListeners(map, 'click');
        };
    }, [map]);

    return <div id="map" ref={mapRef} className="h-full w-full" />;
};

export default Map;