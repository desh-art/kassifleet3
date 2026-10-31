from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
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

# 1. Tenant Verification Middleware/Dependency
async def get_tenant_id(x_tenant_id: str = Header(..., description="The unique identifier for the business/tenant")):
    # In production, verify against your Tenants database table
    valid_tenants = ["tenant_abc_transport", "tenant_ekasi_delivers"]
    if x_tenant_id not in valid_tenants:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive Tenant ID"
        )
    return x_tenant_id

# Helper: Create JWT Token containing both User and Tenant context
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# 2. Multi-Tenant Login Endpoint
@app.post("/auth/login", response_model=Token)
async def login(
    login_data: UserLogin, 
    tenant_id: str = Depends(get_tenant_id)
):
    # Simulated database lookup filtered strictly by tenant_id
    # SQL equivalent: SELECT * FROM users WHERE email = :email AND tenant_id = :tenant_id
    if login_data.email == "owner@kasi.com" and login_data.password == "securepass":
        user_fixtures = {"sub": "owner@kasi.com", "role": "fleet_owner", "tenant_id": tenant_id}
        
        access_token = create_access_token(data=user_fixtures)
        return {"access_token": access_token, "token_type": "bearer", "tenant_id": tenant_id}
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password for this tenant"
    )

# 3. Protected Route verifying both Token and Tenant Identity
async def get_current_user(token: str = Depends(oauth2_scheme), current_tenant: str = Depends(get_tenant_id)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_tenant: str = payload.get("tenant_id")
        user_email: str = payload.get("sub")
        
        # Critical Security Check: Ensure the token belongs to the requested tenant header
        if token_tenant != current_tenant:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token does not match the requested tenant context"
            )
            
        return {"email": user_email, "tenant_id": token_tenant, "role": payload.get("role")}
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

@app.get("/fleet/dashboard")
async def get_fleet_dashboard(current_user: dict = Depends(get_current_user)):
    return {
        "message": f"Welcome back. Accessing fleet data for tenant: {current_user['tenant_id']}",
        "user_role": current_user["role"]
    }