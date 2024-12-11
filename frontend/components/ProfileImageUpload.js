import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@goorm-dev/vapor-core';
import { Alert } from '@goorm-dev/vapor-components';
import { Camera, X } from 'lucide-react';
import authService from '../services/authService';
import PersistentAvatar from './common/PersistentAvatar';

import AWS from 'aws-sdk';

const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION;
const AWS_ACCESS_KEY_ID=process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY=process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY
const S3_BUCKET=process.env.NEXT_PUBLIC_S3_BUCKET

AWS.config.update({
  region: AWS_REGION,
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY
})

// S3 인스턴스 생성
const s3 = new AWS.S3();

const ProfileImageUpload = ({ currentImage, onImageChange }) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // 프로필 이미지 URL 생성
  const getProfileImageUrl = (imagePath) => {
    if (!imagePath) return null;
    return imagePath.startsWith('http') ? 
      imagePath : 
      `${process.env.NEXT_PUBLIC_API_URL}${imagePath}`;
  };

  // 컴포넌트 마운트 시 이미지 설정
  useEffect(() => {
    const imageUrl = getProfileImageUrl(currentImage);
    setPreviewUrl(imageUrl);
  }, [currentImage]);

  // S3에 이미지 업로드하는 함수
  const uploadImage = async (file, userId) => {
    const params = {
      Bucket: S3_BUCKET,
      Key: `images/${userId}/${file.name}`, // 경로 설정
      Body: file,
      ContentType: file.type,
    };
  
    try {
      const data = await s3.upload(params).promise();
      console.log("파일 업로드 성공:", data.Location);
      return data.Location; // 업로드된 파일의 URL 반환
    } catch (err) {
      console.error("파일 업로드 실패:", err);
      throw err; // 에러를 호출한 함수로 전달
    }
  };

  const deleteImage = async (fileUrl) => {
    try {
      const baseUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/`;

      // Key 추출
      if (!fileUrl.startsWith(baseUrl)) {
        throw new Error('S3 버킷 URL과 일치하지 않습니다.');
      }
  
      // URL 디코딩 및 Key 추출
      const encodedKey = fileUrl.replace(baseUrl, ''); // baseUrl 제거
      const decodedKey = decodeURIComponent(encodedKey); // URL 디코딩
  
      console.log('@@@deleteImage fileUrl, decodedKey', fileUrl, decodedKey);
  
      const params = {
        Bucket: S3_BUCKET,
        Key: decodedKey,
      };
  
      // S3에서 객체 삭제
      await s3.deleteObject(params).promise();
      console.log('이미지 삭제 성공:', decodedKey);
    } catch (err) {
      console.error('이미지 삭제 실패:', err);
      throw new Error('S3에서 이미지를 삭제하는 데 실패했습니다.');
    }
  };
  


  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 이미지 파일 검증
      if (!file.type.startsWith('image/')) {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      // 파일 크기 제한 (5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('파일 크기는 5MB를 초과할 수 없습니다.');
      }

      setUploading(true);
      setError('');

      // 파일 미리보기 생성
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // 현재 사용자의 인증 정보 가져오기
      const user = authService.getCurrentUser();
      if (!user?.token) {
        throw new Error('인증 정보가 없습니다.');
      }

      // 파일 업로드 및 URL 가져오기
      const uploadedUrl = await uploadImage(file, user.id);
      console.log('S3에 업로드된 URL:', uploadedUrl);

      // 서버에 URL 전송
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/profile-imageURL`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        body: JSON.stringify({
          profileImage: uploadedUrl, // S3 URL 전달
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '서버 요청 실패');
      }
      
      // 로컬 스토리지의 사용자 정보 업데이트
      const updatedUser = {
        ...user,
        profileImage: uploadedUrl
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // 부모 컴포넌트에 변경 알림
      onImageChange(uploadedUrl);

      // 전역 이벤트 발생
      window.dispatchEvent(new Event('userProfileUpdate'));

    } catch (error) {
      console.error('Image upload error:', error);
      setError(error.message);
      setPreviewUrl(getProfileImageUrl(currentImage));
      
      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      setUploading(true);
      setError('');

      const user = authService.getCurrentUser();
      if (!user?.token) {
        throw new Error('인증 정보가 없습니다.');
      }

      await deleteImage(previewUrl);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/profile-imageURL`, {
        method: 'DELETE',
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '이미지 삭제에 실패했습니다.');
      }

      // 로컬 스토리지의 사용자 정보 업데이트
      const updatedUser = {
        ...user,
        profileImage: ''
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      onImageChange('');

      // 전역 이벤트 발생
      window.dispatchEvent(new Event('userProfileUpdate'));

    } catch (error) {
      console.error('Image removal error:', error);
      setError(error.message);
    } finally {
      setUploading(false);
    }
  };

  // 컴포넌트 언마운트 시 cleanup
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // 현재 사용자 정보 - 로컬 스토리지 참조
  const currentUser = authService.getCurrentUser();

  return (
    <div>
      <div>
        <PersistentAvatar
          user={currentUser}
          size="xl"
          className="w-24 h-24 mx-auto mb-6"
          showInitials={true}
        />
        
        <div className="mt-6">
          <Button
            size="md"
            color="secondary"
            className="rounded-full p-2 mt-3"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Camera className="w-4 h-4" />
          </Button>

          {previewUrl && (
            <Button
              size="md"
              color="danger"
              className="rounded-full p-2 mt-3 ml-2"
              onClick={handleRemoveImage}
              disabled={uploading}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
      />

      {error && (
        <div className="w-full max-w-sm mx-auto">
          <Alert variant="danger" className="mt-2">
            {error}
          </Alert>
        </div>
      )}

      {uploading && (
        <div className="text-sm text-gray-500 text-center mt-2">
          이미지 업로드 중...
        </div>
      )}
    </div>
  );
};

export default ProfileImageUpload;