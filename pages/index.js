import { useEffect, useState } from "react";
import dynamic from 'next/dynamic';
import { collection, addDoc, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import FloatingActionButton from "../components/FloatingActionButton";

// Dynamically import Map component with SSR disabled
const DynamicMap = dynamic(() => import('../components/Map'), { ssr: false });

export default function Home() {
    const [houses, setHouses] = useState([]);
    const [selectedHouse, setSelectedHouse] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    /**
     * Fetches all houses from Firestore on component mount.
     */
    useEffect(() => {
        const fetchHouses = async () => {
            try {
                const q = query(
                    collection(db, "houses"),
                    orderBy("createdAt", "desc")
                );
                const querySnapshot = await getDocs(q);
                const housesList = querySnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                }));

                // Log the fetched houses for debugging
                console.log("Fetched houses:", housesList);

                setHouses(housesList);
            } catch (error) {
                console.error("Error fetching houses: ", error);
            }
        };

        fetchHouses();
    }, []);

    /**
     * Checks if a house with the same normalized address already exists.
     * @param {string} normalizedAddress - The normalized address to check.
     * @returns {Promise<boolean>} - Returns true if house exists, else false.
     */
    const houseExists = async (normalizedAddress) => {
        if (!normalizedAddress) {
            console.error("Normalized address is undefined or null.");
            return false;
        }

        try {
            const q = query(
                collection(db, "houses"),
                where("normalizedAddress", "==", normalizedAddress)
            );
            const querySnapshot = await getDocs(q);
            return !querySnapshot.empty;
        } catch (error) {
            console.error("Error checking house existence: ", error);
            return false;
        }
    };

    /**
     * Adds a new house to Firestore and updates the state.
     * Prevents adding duplicate houses based on address.
     * @param {string} address - The address of the house.
     * @param {Object} location - The latitude and longitude of the house.
     */
    const addMarker = async (address, location) => {
        console.log("Attempting to add marker for address:", address);

        // Validate inputs
        if (!address || !location || typeof address !== "string" || typeof location !== "object") {
            console.error("Invalid parameters passed to addMarker:", { address, location });
            alert("Invalid address or location. Please try again.");
            return;
        }

        // Normalize the address for consistent comparison
        const normalizedAddress = address.trim().toLowerCase();

        try {
            // Check if the house already exists
            const exists = await houseExists(normalizedAddress);
            if (exists) {
                alert("This house already exists on the map.");
                return;
            }

            // Add to Firestore with hasLights implied as all houses have lights
            const docRef = await addDoc(collection(db, "houses"), {
                address: address,
                normalizedAddress: normalizedAddress, // Store normalized address
                location: location,
                hasLights: true, // Since all houses have lights
                createdAt: new Date(),
                photos: [], // Initialize with empty photos array
            });

            console.log("Document written with ID: ", docRef.id);

            // Update local houses state
            const newHouse = {
                id: docRef.id,
                address,
                normalizedAddress,
                location,
                hasLights: true,
                createdAt: new Date(),
                photos: [],
            };
            setHouses([newHouse, ...houses]);
            setSelectedHouse(newHouse); // Select the new house
        } catch (error) {
            console.error("Error adding document: ", error);
            alert("An error occurred while processing the address.");
        }
    };

    /**
     * Handles selecting a house (e.g., from search).
     * Centers the map on the selected house.
     * @param {Object} house - The house object to select.
     */
    const handleSelectHouse = (house) => {
        setSelectedHouse(house);
    };

    return (
        <div className="flex h-screen flex-col md:flex-row bg-cover bg-center" style={{ backgroundImage: "url('/images/snow-background.jpg')" }}>
            {/* Navbar for mobile */}
            <Navbar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />

            {/* Sidebar */}
            <div className={`fixed z-40 inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition duration-200 ease-in-out md:relative md:translate-x-0 md:w-1/3 md:flex`}>
                <Sidebar
                    addMarker={addMarker}
                    onSelectHouse={handleSelectHouse}
                    houses={houses} // Pass houses array
                    closeSidebar={() => setIsSidebarOpen(false)}
                />
            </div>

            {/* Overlay when sidebar is open on mobile */}
            {isSidebarOpen && <div className="fixed inset-0 bg-black opacity-50 z-30 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>}

            {/* Map */}
            <div className="flex-1 mt-16 md:mt-0">
                <DynamicMap
                    addMarker={addMarker}
                    houses={houses}
                    selectedHouse={selectedHouse}
                    onSelectHouse={handleSelectHouse}
                />
            </div>

            {/* Floating Action Button */}
            {!isSidebarOpen && (
                <div className="md:hidden">
                    <FloatingActionButton onClick={() => setIsSidebarOpen(true)} />
                </div>
            )}
        </div>
    );
}
