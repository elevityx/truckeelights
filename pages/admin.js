import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, updateDoc, doc, query, where } from "firebase/firestore";

const Admin = () => {
  const [user, setUser] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState({ email: "", password: "" });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        fetchPhotos();
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchPhotos = async () => {
    try {
      const housesSnapshot = await getDocs(collection(db, "houses"));
      let allPhotos = [];

      for (const houseDoc of housesSnapshot.docs) {
        const photosSnapshot = await getDocs(collection(db, "houses", houseDoc.id, "photos"));
        photosSnapshot.forEach((photoDoc) => {
          allPhotos.push({ id: photoDoc.id, ...photoDoc.data(), houseId: houseDoc.id });
        });
      }

      setPhotos(allPhotos);
    } catch (error) {
      console.error("Error fetching photos:", error);
      alert("Failed to fetch photos.");
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
    } catch (error) {
      console.error("Error logging in:", error);
      alert("Failed to log in. Please check your credentials.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error logging out:", error);
      alert("Failed to log out.");
    }
  };

  const handleApprove = async (houseId, photoId) => {
    try {
      const photoRef = doc(db, "houses", houseId, "photos", photoId);
      await updateDoc(photoRef, { reviewed: true });
      setPhotos((prevPhotos) =>
        prevPhotos.map((photo) =>
          photo.id === photoId && photo.houseId === houseId
            ? { ...photo, reviewed: true }
            : photo
        )
      );
      alert("Photo approved successfully.");
    } catch (error) {
      console.error("Error approving photo:", error);
      alert("Failed to approve photo.");
    }
  };

  const notReviewedPhotos = photos.filter((photo) => !photo.reviewed);
  const reviewedPhotos = photos.filter((photo) => photo.reviewed);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <h2 className="text-2xl mb-4">Admin Login</h2>
        <form onSubmit={handleLogin} className="w-80 bg-white p-6 rounded shadow-md">
          <div className="mb-4">
            <label className="block text-gray-700">Email:</label>
            <input
              type="email"
              value={credentials.email}
              onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
              required
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700">Password:</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              required
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl">Admin Dashboard</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          Logout
        </button>
      </div>

      <div className="mb-8">
        <h2 className="text-2xl mb-4">Unreviewed Photos</h2>
        {notReviewedPhotos.length === 0 ? (
          <p>No unreviewed photos.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {notReviewedPhotos.map((photo) => (
              <div key={photo.id} className="bg-white p-4 rounded shadow">
                <img src={photo.downloadURL} alt={`Photo of house ${photo.houseId}`} className="w-full h-40 object-cover mb-2 rounded" />
                <button
                  onClick={() => handleApprove(photo.houseId, photo.id)}
                  className="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600"
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-2xl mb-4">Reviewed Photos</h2>
        {reviewedPhotos.length === 0 ? (
          <p>No reviewed photos.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {reviewedPhotos.map((photo) => (
              <div key={photo.id} className="bg-white p-4 rounded shadow">
                <img src={photo.downloadURL} alt={`Photo of house ${photo.houseId}`} className="w-full h-40 object-cover mb-2 rounded" />
                <span className="text-sm text-gray-600">Approved</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
