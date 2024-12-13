import { useState, useEffect, useRef } from "react";

const Sidebar = ({ addMarker, onSelectHouse, houses, closeSidebar }) => {
    const [address, setAddress] = useState("");
    const [isAdding, setIsAdding] = useState(false);

    const searchInputRef = useRef(null);
    const autocompleteRef = useRef(null);

    useEffect(() => {
        if (typeof google !== "undefined" && google.maps && google.maps.places) {
            autocompleteRef.current = new google.maps.places.Autocomplete(searchInputRef.current, {
                types: ["address"],
                componentRestrictions: { country: "us" },
            });
            
            autocompleteRef.current.addListener("place_changed", () => {
                const place = autocompleteRef.current.getPlace();
                if (place && place.formatted_address) {
                    setAddress(place.formatted_address);
                }
            });
        }
    }, []);

    const handleAddressSubmit = async (e) => {
        e.preventDefault();

        if (!address.trim()) {
            alert("Please provide an address!");
            return;
        }

        setIsAdding(true);

        const normalizeAddress = (address) => address.trim().toLowerCase();

        const normalizedAddress = normalizeAddress(address);

        // Check if the house exists in the houses array
        const existingHouse = houses.find(
            (h) => h.normalizedAddress === normalizedAddress
        );

        if (existingHouse) {
            // House exists in Firebase
            onSelectHouse(existingHouse);
            setIsAdding(false);
        } else {
            // House not in database, perform geocoding
            if (typeof google === "undefined" || !google.maps) {
                alert("Google Maps API is not loaded yet.");
                setIsAdding(false);
                return;
            }
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: address }, (results, status) => {
                if (status === "OK" && results[0]) {
                    const location = results[0].geometry.location.toJSON();
                    const newHouse = {
                        id: null, // House not in database yet
                        address: results[0].formatted_address,
                        normalizedAddress: normalizeAddress(results[0].formatted_address),
                        location: location,
                    };
                    // Notify parent to handle this new house
                    onSelectHouse(newHouse);
                } else {
                    alert(
                        "Geocode was not successful for the following reason: " + status
                    );
                }
                setIsAdding(false);
            });
        }

        setAddress("");

        // Close the sidebar on mobile after submitting
        if (closeSidebar) {
            closeSidebar();
        }
    };

    return (
        <div className="flex flex-col space-y-6 bg-christmasGreen p-6 text-snowWhite h-full w-64 md:w-full">
            {/* Close Button on Mobile */}
            <button
                className="self-end md:hidden"
                onClick={closeSidebar}
            >
                <svg className="h-6 w-6 text-snowWhite" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {/* Close Icon */}
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Sidebar Content */}
            <h1 className="text-4xl font-bold text-gold hidden md:block">🎅 Truckee Lights</h1>
            <p className="text-lg">
                Your map to a Christmas light tour of Truckee. Please be respectful of neighbors, adhere to speed limits, and enjoy the festive spirit responsibly!
            </p>

            {/* Search/Add House Section */}
            <h2 className="text-2xl font-semibold">🏠 Search or Add a House</h2>
            <form onSubmit={handleAddressSubmit} className="flex flex-col space-y-4">
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Enter address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="p-3 border border-snowWhite rounded bg-snowWhite text-christmasGreen placeholder-christmasGreen focus:outline-none focus:ring-2 focus:ring-gold"
                    required
                />
                <button
                    type="submit"
                    className="p-3 bg-gold text-christmasGreen font-semibold rounded hover:bg-snowWhite hover:text-christmasGreen transition text-lg"
                    disabled={isAdding}
                >
                    {isAdding ? "Processing..." : "Submit"}
                </button>
            </form>

            <p className="text-sm text-gray-200">
                🎄 Click on the map to add a house or use the forms above to add/find a house with Christmas lights.
            </p>
        </div>
    );
};

export default Sidebar;