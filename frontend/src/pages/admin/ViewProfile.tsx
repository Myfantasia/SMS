import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, BookOpen } from 'lucide-react';

export default function ViewProfile() {
  const { userType, id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/user/${userType}/${id}/`);
        const data = await response.json();
        if (data.status === 'success') {
          setProfile(data.data);
        } else {
          alert("Error loading profile");
        }
      } catch (error) {
        console.error("Failed to fetch profile", error);
      }
      setLoading(false);
    };

    fetchProfile();
  }, [userType, id]);

  if (loading) return <div className="p-6 text-gray-500 animate-pulse">Loading profile...</div>;
  if (!profile) return <div className="p-6 text-red-500">Profile not found.</div>;

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-blue-600 mb-6 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to Directory
      </button>

      <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8">
        <div className="flex items-center gap-4 mb-8 border-b pb-6">
          
          {/* PROFILE PICTURE LOGIC */}
          {profile.profile_pic ? (
            <img 
              src={profile.profile_pic} 
              alt={profile.name} 
              className="w-16 h-16 rounded-full object-cover border-2 border-indigo-100 shadow-sm"
            />
          ) : (
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold uppercase">
              {profile.name.charAt(0)}
            </div>
          )}

          <div>
            <h1 className="text-2xl font-bold text-gray-800">{profile.name}</h1>
            <p className="text-gray-500 capitalize">{userType} • {profile.username}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase">Email Address</p>
              <p className="text-gray-800">{profile.email || "N/A"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase">Mobile Number</p>
              <p className="text-gray-800">{profile.mobile || "N/A"}</p>
            </div>
          </div>

          {profile.address && (
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase">Home Address</p>
                <p className="text-gray-800">{profile.address}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase">
                {userType === 'students' ? 'Class Enrolled' : userType === 'teachers' ? 'Subjects Taught' : 'Linked Children'}
              </p>
              <p className="text-gray-800 font-medium">
                {profile.class || profile.subjects || profile.children || "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}