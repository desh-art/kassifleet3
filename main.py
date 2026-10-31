from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import jwt

# Configuration
SECRET_KEY = "your_super_secret_kasi_fleet_key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

app = FastAPI(title="Kasi Fleet Multi-Tenant Auth API")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Pydantic Schemas
class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    tenant_id: str
    role: str

# 1. Tenant Verification Dependency
async def get_tenant_id(x_tenant_id: str = Header(..., description="The unique identifier for the taxi association/fleet")):
    # Simulated active fleet tenants (e.g., local taxi associations or delivery systems)
    valid_tenants = ["tenant_abc_transport", "tenant_ekasi_delivers", "kasi_fleet_hq"]
    if x_tenant_id not in valid_tenants:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive Tenant ID"
        )
    return x_tenant_id

# Helper: Create JWT Token
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# 2. Multi-Tenant Login Endpoint (Fixed for both Customers and Drivers)
@app.post("/auth/login", response_model=Token)
async def login(
    login_data: UserLogin, 
    tenant_id: str = Depends(get_tenant_id)
):
    # Simulated User Database (Checking both customer owners and drivers)
    # In production, look this up dynamically from your database using matching tenant_id
    
    # Check 1: Is it a Customer / Fleet Owner?
    if login_data.email == "owner@kasi.com" and login_data.password == "securepass":
        user_role = "fleet_owner"
        
    # Check 2: Is it a Driver?
    elif login_data.email == "driver@kasi.com" and login_data.password == "driverpass":
        user_role = "driver"
        
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password for this tenant workspace"
        )

    # Encode user details and role directly into the token
    user_fixtures = {"sub": login_data.email, "role": user_role, "tenant_id": tenant_id}
    access_token = create_access_token(data=user_fixtures)
    
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "tenant_id": tenant_id,
        "role": user_role
    }

# 3. Protected Route checking Token Context
async def get_current_user(token: str = Depends(oauth2_scheme), current_tenant: str = Depends(get_tenant_id)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_tenant: str = payload.get("tenant_id")
        user_email: str = payload.get("sub")
        user_role: str = payload.get("role")
        
        if token_tenant != current_tenant:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token mismatch. You cannot access data outside your assigned fleet."
            )
            
        return {"email": user_email, "tenant_id": token_tenant, "role": user_role}
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

# Dashboard route showing role-based separation
@app.get("/fleet/dashboard")
async def get_fleet_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user["role"] == "driver":
        return {
            "message": f"Driver view active for {current_user['email']}",
            "allowed_actions": ["view_assigned_trips", "update_job_status", "clock_in"]
        }
        
    return {
        "message": f"Fleet Owner management dashboard active for tenant {current_user['tenant_id']}",
        "allowed_actions": ["view_all_drivers", "track_live_vehicles", "billing"]
    }
