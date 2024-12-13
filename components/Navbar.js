import React from 'react';

const Navbar = ({ isSidebarOpen, setIsSidebarOpen }) => {
    return (
        <nav className="fixed w-full z-50 bg-christmasGreen text-snowWhite md:hidden">
            <div className="flex items-center justify-between p-4">
                {/* Hamburger Menu */}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="text-snowWhite focus:outline-none"
                >
                    {/* Hamburger Icon */}
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isSidebarOpen ? (
                            // Close Icon
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            // Hamburger Icon
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        )}
                    </svg>
                </button>

                {/* App Title */}
                <h1 className="text-2xl font-bold text-gold">
                    🎅 Truckee Lights
                </h1>

                {/* Spacer to center the title */}
                <div className="w-6"></div>
            </div>
        </nav>
    );
};

export default Navbar;
