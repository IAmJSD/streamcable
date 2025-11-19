//! Rolling uint encoding and decoding
//!
//! Variable-length integer encoding used throughout the protocol

use crate::error::StreamcableError;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Calculate the size needed to encode a rolling uint
pub fn get_rolling_uint_size(data: u64) -> usize {
    if data < 0xfd {
        1
    } else if data <= 0xffff {
        3
    } else if data <= 0xffffffff {
        5
    } else {
        9
    }
}

/// Write a rolling uint to a buffer at the specified position
/// Returns the new position after writing
pub fn write_rolling_uint_no_alloc(data: u64, buf: &mut [u8], pos: usize) -> usize {
    if data < 0xfd {
        buf[pos] = data as u8;
        pos + 1
    } else if data <= 0xffff {
        buf[pos] = 0xfd;
        buf[pos + 1] = (data & 0xff) as u8;
        buf[pos + 2] = ((data >> 8) & 0xff) as u8;
        pos + 3
    } else if data <= 0xffffffff {
        buf[pos] = 0xfe;
        buf[pos + 1] = (data & 0xff) as u8;
        buf[pos + 2] = ((data >> 8) & 0xff) as u8;
        buf[pos + 3] = ((data >> 16) & 0xff) as u8;
        buf[pos + 4] = ((data >> 24) & 0xff) as u8;
        pos + 5
    } else {
        buf[pos] = 0xff;
        buf[pos + 1] = (data & 0xff) as u8;
        buf[pos + 2] = ((data >> 8) & 0xff) as u8;
        buf[pos + 3] = ((data >> 16) & 0xff) as u8;
        buf[pos + 4] = ((data >> 24) & 0xff) as u8;
        buf[pos + 5] = ((data >> 32) & 0xff) as u8;
        buf[pos + 6] = ((data >> 40) & 0xff) as u8;
        buf[pos + 7] = ((data >> 48) & 0xff) as u8;
        buf[pos + 8] = ((data >> 56) & 0xff) as u8;
        pos + 9
    }
}

/// Read a rolling uint from an async reader
pub async fn read_rolling_uint<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<u64, StreamcableError> {
    let first_byte = reader.read_u8().await?;
    
    if first_byte < 0xfd {
        Ok(first_byte as u64)
    } else if first_byte == 0xfd {
        let mut bytes = [0u8; 2];
        reader.read_exact(&mut bytes).await?;
        Ok((bytes[0] as u64) | ((bytes[1] as u64) << 8))
    } else if first_byte == 0xfe {
        let mut bytes = [0u8; 4];
        reader.read_exact(&mut bytes).await?;
        Ok((bytes[0] as u64)
            | ((bytes[1] as u64) << 8)
            | ((bytes[2] as u64) << 16)
            | ((bytes[3] as u64) << 24))
    } else {
        let mut bytes = [0u8; 8];
        reader.read_exact(&mut bytes).await?;
        Ok((bytes[0] as u64)
            | ((bytes[1] as u64) << 8)
            | ((bytes[2] as u64) << 16)
            | ((bytes[3] as u64) << 24)
            | ((bytes[4] as u64) << 32)
            | ((bytes[5] as u64) << 40)
            | ((bytes[6] as u64) << 48)
            | ((bytes[7] as u64) << 56))
    }
}

/// Write a rolling uint to an async writer
#[allow(dead_code)]
pub async fn write_rolling_uint<W: AsyncWrite + Unpin>(
    writer: &mut W,
    data: u64,
) -> Result<(), StreamcableError> {
    if data < 0xfd {
        writer.write_u8(data as u8).await?;
    } else if data <= 0xffff {
        writer.write_u8(0xfd).await?;
        writer.write_u8((data & 0xff) as u8).await?;
        writer.write_u8(((data >> 8) & 0xff) as u8).await?;
    } else if data <= 0xffffffff {
        writer.write_u8(0xfe).await?;
        writer.write_u8((data & 0xff) as u8).await?;
        writer.write_u8(((data >> 8) & 0xff) as u8).await?;
        writer.write_u8(((data >> 16) & 0xff) as u8).await?;
        writer.write_u8(((data >> 24) & 0xff) as u8).await?;
    } else {
        writer.write_u8(0xff).await?;
        writer.write_u8((data & 0xff) as u8).await?;
        writer.write_u8(((data >> 8) & 0xff) as u8).await?;
        writer.write_u8(((data >> 16) & 0xff) as u8).await?;
        writer.write_u8(((data >> 24) & 0xff) as u8).await?;
        writer.write_u8(((data >> 32) & 0xff) as u8).await?;
        writer.write_u8(((data >> 40) & 0xff) as u8).await?;
        writer.write_u8(((data >> 48) & 0xff) as u8).await?;
        writer.write_u8(((data >> 56) & 0xff) as u8).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rolling_uint_size() {
        assert_eq!(get_rolling_uint_size(0), 1);
        assert_eq!(get_rolling_uint_size(252), 1);
        assert_eq!(get_rolling_uint_size(253), 3);
        assert_eq!(get_rolling_uint_size(0xffff), 3);
        assert_eq!(get_rolling_uint_size(0x10000), 5);
        assert_eq!(get_rolling_uint_size(0xffffffff), 5);
        assert_eq!(get_rolling_uint_size(0x100000000), 9);
    }

    #[test]
    fn test_write_rolling_uint() {
        let mut buf = vec![0u8; 100];
        
        // Test single byte
        let pos = write_rolling_uint_no_alloc(42, &mut buf, 0);
        assert_eq!(pos, 1);
        assert_eq!(buf[0], 42);
        
        // Test 2-byte encoding
        let pos = write_rolling_uint_no_alloc(300, &mut buf, 0);
        assert_eq!(pos, 3);
        assert_eq!(buf[0], 0xfd);
        assert_eq!(buf[1], 44);  // 300 & 0xff
        assert_eq!(buf[2], 1);   // (300 >> 8) & 0xff
    }
}
