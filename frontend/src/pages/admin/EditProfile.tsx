import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';

export default function EditProfile() {
  const { userType, id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Expanded Form State
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', username: '', email: '',
    mobile: '', address: '', status: 'true',
    class: '', roll: '', fee: '', parent_name: '', parent_mobile: '',
    subjects: '', id_number: '', salary: '',
    relationship: '', children_rolls: '', children_display: '' // <-- Added display field
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/user/${userType}/${id}/`);
        const data = await response.json();
        if (data.status === 'success') {
          const d = data.data;
          setFormData({
            first_name: d.first_name || '',
            last_name: d.last_name || '',
            username: d.username || '',
            email: d.email || '',
            mobile: d.mobile || '',
            address: d.address || '',
            status: d.status === true ? 'true' : 'false',
            class: d.class || '',
            roll: d.roll || '',
            fee: d.fee || '',
            parent_name: d.parent_name || '',
            parent_mobile: d.parent_mobile || '',
            subjects: d.subjects || '',
            id_number: d.id_number || '',
            salary: d.salary || '',
            relationship: d.relationship || 'Father',
            children_rolls: d.children_rolls || '',
            children_display: d.children_display || '' // <-- Capture the names from Django
          });
        }
      } catch (error) {
        console.error("Failed to fetch profile", error);
      }
      setLoading(false);
    };

    fetchProfile();
  }, [userType, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/user/${userType}/${id}/edit/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        alert('Profile updated successfully!');
        navigate(`/admin-dashboard/${userType}`); 
      } else {
        alert('Failed to update: ' + data.message);
      }
    } catch (error) {
      console.error('Error saving profile', error);
      alert('An error occurred while saving.');
    }
    setSaving(false);
  };

  if (loading) return <div className="p-6 text-gray-500 animate-pulse">Loading editor...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-blue-600 mb-6 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to Directory
      </button>

      <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8">
        <div className="mb-8 border-b pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 capitalize">Edit {userType} Profile</h1>
            <p className="text-gray-500 text-sm">Update personal, academic, and system information below.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* SECTION 1: Core Account Details */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Account Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} title="First Name" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} title="Last Name" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username (System ID)</label>
                <input type="text" name="username" value={formData.username} onChange={handleChange} title="Username (System ID)" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} title="Email Address" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                <input type="text" name="mobile" value={formData.mobile} onChange={handleChange} title="Mobile Number" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Status</label>
                <select name="status" value={formData.status} onChange={handleChange} title="Account Status" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50">
                  <option value="true">Active / Approved</option>
                  <option value="false">Pending / Suspended</option>
                </select>
              </div>
              
              {userType !== 'parents' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Home Address</label>
                  <input type="text" name="address" value={formData.address} onChange={handleChange} title="Home Address" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: Specific Role Details */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">
              {userType === 'students' ? 'Academic & Parent Details' : userType === 'teachers' ? 'Professional Details' : 'Relationship Details'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* STUDENT FIELDS */}
              {userType === 'students' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Admission Number (Roll)</label>
                    <input type="text" name="roll" value={formData.roll} onChange={handleChange} title="Admission Number (Roll)" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Class Enrolled</label>
                    <input type="text" name="class" value={formData.class} onChange={handleChange} title="Class Enrolled" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fee Balance</label>
                    <input type="number" name="fee" value={formData.fee} onChange={handleChange} title="Fee Balance" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian Name</label>
                      <input type="text" name="parent_name" value={formData.parent_name} onChange={handleChange} title="Parent/Guardian Name" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Parent Mobile</label>
                      <input type="text" name="parent_mobile" value={formData.parent_mobile} onChange={handleChange} title="Parent Mobile" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                    </div>
                  </div>
                </>
              )}

              {/* TEACHER FIELDS */}
              {userType === 'teachers' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">National ID Number</label>
                    <input type="text" name="id_number" value={formData.id_number} onChange={handleChange} title="National ID Number" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Salary (Ksh)</label>
                    <input type="number" name="salary" value={formData.salary} onChange={handleChange} title="Monthly Salary (Ksh)" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subjects Taught (Comma separated)</label>
                    <input type="text" name="subjects" value={formData.subjects} onChange={handleChange} title="Subjects Taught (Comma separated)" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                </>
              )}

              {/* PARENT FIELDS WITH NEW HIGHLIGHTED MANAGEMENT BOX */}
              {userType === 'parents' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship to Child</label>
                    <select name="relationship" value={formData.relationship} onChange={handleChange} title="Relationship to Child" className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 bg-slate-50">
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className="md:col-span-2 bg-blue-50 p-5 rounded-lg border border-blue-100 mt-2">
                    <h4 className="font-bold text-blue-900 mb-3 text-sm uppercase tracking-wider">Linked Children Management</h4>
                    
                    {/* Read-Only Display of Names */}
                    <div className="mb-4 bg-white p-3 rounded border border-blue-50 shadow-sm">
                      <span className="block text-xs font-semibold text-gray-500 mb-1">Currently Linked Students:</span>
                      <p className="text-gray-800 font-medium">
                        {formData.children_display ? formData.children_display : <span className="text-red-500 italic">No students currently linked.</span>}
                      </p>
                    </div>

                    {/* Editable Input for Roll Numbers */}
                    <div>
                      <label className="block text-sm font-medium text-blue-800 mb-1">Update Linked Admission Numbers (Rolls)</label>
                      <input 
                        type="text" 
                        name="children_rolls" 
                        value={formData.children_rolls} 
                        onChange={handleChange} 
                        placeholder="e.g. 1001, 1005" 
                        title="Update Linked Admission Numbers (Rolls)"
                        className="w-full p-2 border border-blue-200 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white" 
                      />
                      <p className="text-xs text-blue-600 mt-2">Enter the admission numbers separated by commas to update the links. To remove all children, clear this field.</p>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>

          <div className="flex justify-end pt-4 border-t mt-8">
            <button type="submit" disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-md font-medium transition shadow-sm">
              <Save className="w-5 h-5" />
              {saving ? 'Saving Changes...' : 'Save All Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}