
const
 { data, error } = 
await
 supabase.auth.signUp({
  email,
  password,
  
options
: {
    
data
: {
      
full_name
: fullName,
      phone,
    },
  },
})
// Login

const
 { data, error } = 
await
 supabase.auth.signInWithPassword({
  email,
  password,
})