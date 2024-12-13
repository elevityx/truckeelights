import React from 'react';

const FloatingActionButton = ({ onClick }) => {
    return (
        <button
            onClick={onClick}
            className="fixed bottom-4 right-4 bg-gold text-christmasGreen p-4 rounded-full shadow-lg hover:bg-snowWhite transition duration-200"
        >
            {/* Plus Icon */}
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
            </svg>
        </button>
    );
};

export default FloatingActionButton;
